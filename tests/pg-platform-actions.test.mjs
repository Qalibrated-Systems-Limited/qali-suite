/**
 * The SuperAdmin platform dashboard, on Postgres.
 *
 * `company-queries.js` read the Mongo `Company` model. Companies moved to
 * Postgres in 0035, so every figure on this dashboard — counts, subscription
 * mix, MRR, expiring trials, alerts — came from a collection nothing writes to.
 *
 * These are PRIVILEGED, cross-company reads, which is the one place that is
 * correct: the dashboard's purpose is to look across tenants, and no
 * tenant-scoped connection can. So there is no `getTenantContext` mock here —
 * the functions do not take one.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const platform = await import("@/app/db/actions/platform-actions");

suite("platform actions", () => {
  let admin;

  const company = (over = {}) => {
    const id = randomUUID();
    const {
      name = "Acme",
      plan = "free",
      status = "active",
      subStatus = "trial",
      trialEnds = null,
      periodEnd = null,
      maxUsers,
    } = over;
    // max_users is NOT NULL with a default, so it is only named when a test
    // actually cares about the seat limit.
    return (maxUsers == null
      ? admin`
          INSERT INTO companies (id, name, slug, plan, status, subscription_status,
                                 trial_ends_at, current_period_end)
          VALUES (${id}, ${name}, ${"s-" + id.slice(0, 8)}, ${plan}, ${status},
                  ${subStatus}, ${trialEnds}, ${periodEnd})`
      : admin`
          INSERT INTO companies (id, name, slug, plan, status, subscription_status,
                                 trial_ends_at, current_period_end, max_users)
          VALUES (${id}, ${name}, ${"s-" + id.slice(0, 8)}, ${plan}, ${status},
                  ${subStatus}, ${trialEnds}, ${periodEnd}, ${maxUsers})`
    ).then(() => id);
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
  });

  describe("headline metrics", () => {
    it("counts companies by subscription state", async () => {
      await company({ subStatus: "active" });
      await company({ subStatus: "trial" });
      await company({ subStatus: "trial", status: "suspended" });

      const m = await platform.getPlatformMetrics();
      expect(m.companies.total).toBe(3);
      expect(m.companies.active).toBe(1);
      expect(m.companies.trial).toBe(2);
      expect(m.companies.suspended).toBe(1);
    });

    it("flags trials and subscriptions expiring within the week", async () => {
      await company({
        subStatus: "trial",
        trialEnds: new Date(Date.now() + 3 * 864e5),
      });
      // Outside the window — must not be flagged.
      await company({
        subStatus: "trial",
        trialEnds: new Date(Date.now() + 30 * 864e5),
      });
      await company({
        subStatus: "active",
        periodEnd: new Date(Date.now() + 2 * 864e5),
      });

      const m = await platform.getPlatformMetrics();
      expect(m.alerts.trialsExpiring).toBe(1);
      expect(m.alerts.subscriptionsExpiring).toBe(1);
    });
  });

  describe("subscription mix", () => {
    it("gives each plan its share and colour", async () => {
      await company({ plan: "professional" });
      await company({ plan: "professional" });
      await company({ plan: "free" });

      const d = await platform.getSubscriptionDistribution();
      const pro = d.find((x) => x.name === "professional");
      expect(pro.value).toBe(2);
      expect(pro.percentage).toBe(67);
      expect(pro.color).toBe("#3b82f6");
      // Shares are of the whole, so they add up.
      expect(d.reduce((s, x) => s + x.value, 0)).toBe(3);
    });
  });

  describe("expiries", () => {
    it("says how long is left, and separates trials from subscriptions", async () => {
      await company({
        name: "TrialCo",
        subStatus: "trial",
        trialEnds: new Date(Date.now() + 3 * 864e5),
      });
      await company({
        name: "PaidCo",
        plan: "starter",
        subStatus: "active",
        periodEnd: new Date(Date.now() + 5 * 864e5),
      });

      const e = await platform.getExpiringCompanies();
      expect(e.trials).toHaveLength(1);
      expect(e.trials[0].name).toBe("TrialCo");
      // A NUMBER, not a string: the badge does `daysRemaining <= 2` and
      // renders `{daysRemaining}d`.
      expect(typeof e.trials[0].daysRemaining).toBe("number");
      expect(e.trials[0].daysRemaining).toBeGreaterThan(0);
      expect(e.subscriptions[0].name).toBe("PaidCo");
      expect(e.subscriptions[0].plan).toBe("starter");
    });
  });

  describe("MRR", () => {
    it("prices each company from the plan it is on", async () => {
      await company({ plan: "professional", subStatus: "active" }); // 25,000
      await company({ plan: "starter", subStatus: "active" }); //      10,000
      await company({ plan: "free", subStatus: "trial" }); //               0
      // Suspended companies are not recurring revenue.
      await company({ plan: "enterprise", subStatus: "expired" });

      const m = await platform.getMRRMetrics();
      expect(m.current).toBe(35000);
      const pro = m.breakdown.find((b) => b.plan === "professional");
      expect(pro.revenue).toBe(25000);
    });

    it("reports no change rather than infinity from a zero base", async () => {
      const m = await platform.getMRRMetrics();
      expect(m.current).toBe(0);
      expect(m.trend).toBe(0);
    });
  });

  describe("company health", () => {
    it("scores out of five, the way the Mongo version did", async () => {
      // active (2) + active subscription (2) + has users (1) = 5
      const id = await company({ status: "active", subStatus: "active" });
      const userId = randomUUID();
      await admin`
        INSERT INTO users (id, name, email, role, status)
        VALUES (${userId}, 'U', ${userId.slice(0, 8) + "@x.com"}, 'Admin', 'active')`;
      await admin`
        INSERT INTO user_company_access (user_id, company_id, granted_via, status)
        VALUES (${userId}, ${id}, 'manual', 'active')`;

      const [h] = await platform.getCompanyHealthOverview();
      expect(h.health).toBe(5);
      expect(h.userCount).toBe(1);
      // The overview carries no revenue; only the WithRevenue variant does.
      expect(h.revenue).toBeUndefined();
    });

    it("scores a suspended company on a trial lower", async () => {
      await company({ status: "suspended", subStatus: "trial" });
      const [h] = await platform.getCompanyHealthOverview();
      // no status points + trial (1) + no users = 1
      expect(h.health).toBe(1);
    });

    it("adds revenue in the WithRevenue variant", async () => {
      await company({ status: "active", subStatus: "active" });
      const [h] = await platform.getCompanyHealthWithRevenue();
      expect(h.revenue).toBe(0);
    });
  });

  describe("alerts and charts", () => {
    it("raises an alert per condition, and none when all is well", async () => {
      await company({ status: "active", subStatus: "active" });
      expect(await platform.getSystemAlerts()).toEqual([]);

      await company({ status: "suspended" });
      const alerts = await platform.getSystemAlerts();
      expect(alerts.some((a) => a.type === "critical")).toBe(true);
      expect(alerts[0].message).toMatch(/suspended/);
    });

    it("flags a company at its seat limit", async () => {
      const id = await company({ maxUsers: 1 });
      const userId = randomUUID();
      await admin`
        INSERT INTO users (id, name, email, role, status)
        VALUES (${userId}, 'U', ${userId.slice(0, 8) + "@x.com"}, 'Admin', 'active')`;
      await admin`
        INSERT INTO user_company_access (user_id, company_id, granted_via, status)
        VALUES (${userId}, ${id}, 'manual', 'active')`;

      const alerts = await platform.getSystemAlerts();
      expect(alerts.some((a) => /user limit/.test(a.message))).toBe(true);
    });

    it("returns 30 zero-filled days for the activity chart", async () => {
      const chart = await platform.getPlatformActivityChart();
      expect(chart).toHaveLength(30);
      expect(chart[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A quiet day is a zero, not a missing point.
      expect(chart.every((d) => typeof d.newUsers === "number")).toBe(true);
    });

    it("lists new companies and users as one feed", async () => {
      await company({ name: "Newest" });
      const feed = await platform.getRecentPlatformActivity(5);
      expect(feed[0].message).toMatch(/New company: Newest/);
      expect(feed[0].relativeTime).toBeTruthy();
      expect(feed[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
