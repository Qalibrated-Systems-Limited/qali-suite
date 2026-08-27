"use server";

import { sql } from "drizzle-orm";
import { privilegedDb } from "../provisioning";

/**
 * The SuperAdmin platform dashboard, on Postgres.
 *
 * `app/mongodb/queries/company-queries.js` reads the Mongo `Company` model.
 * Companies moved to Postgres in 0035, so every figure on the platform
 * dashboard — company counts, subscription mix, MRR, expiring trials, system
 * alerts — has been derived from a collection nothing writes to. Same failure
 * as the statements and the tenant dashboard before it.
 *
 * PRIVILEGED, NOT TENANT-SCOPED, and this is the one place that is correct.
 * Every other read in the app goes through `withAuthorizedTenant` so RLS
 * confines it to one company. This dashboard's whole purpose is to look ACROSS
 * companies, which no tenant-scoped connection can do. The screens that call it
 * are already behind a SuperAdmin gate.
 *
 * Names and shapes match the Mongo functions exactly, so the three SuperAdmin
 * tabs are an import swap.
 */

const int = (v: unknown) => Number(v ?? 0);

/** What each plan bills per month, in KES. Mirrors lib/plans.js. */
const PLAN_PRICING: Record<string, number> = {
  enterprise: 50000,
  professional: 25000,
  starter: 10000,
  free: 0,
};

const PLAN_COLORS: Record<string, string> = {
  enterprise: "#8b5cf6",
  professional: "#3b82f6",
  starter: "#f59e0b",
  free: "#6b7280",
};

/**
 * Days until the date, as a NUMBER despite the name.
 *
 * The Mongo function was called formatDaysRemaining and returned a bare
 * integer. A friendlier string read better and was wrong: the screen does
 * `daysRemaining <= 2` to colour the badge and renders `{daysRemaining}d`, so
 * a string breaks the comparison and prints "3 days leftd". tsc caught it.
 */
function formatDaysRemaining(date: unknown): number {
  if (!date) return 0;
  return Math.ceil(
    (new Date(date as string).getTime() - Date.now()) / 86_400_000,
  );
}

/**
 * Company and user counts, and the three figures the alert row reads.
 *
 * `activeToday` counts users whose session was refreshed today — the closest
 * Postgres equivalent to the Mongo `lastLoginAt` the old query used, and it
 * comes from the same column the freshness check writes.
 */
export async function getPlatformMetrics() {
  const [row] = (await privilegedDb().execute(sql`
    SELECT
      (SELECT count(*) FROM companies)::int                                        AS total,
      (SELECT count(*) FROM companies WHERE subscription_status = 'active')::int   AS active,
      (SELECT count(*) FROM companies WHERE subscription_status = 'trial')::int    AS trial,
      -- is_active is GENERATED AS (status = 'active'), so testing it here
      -- would also count 'inactive' companies as suspended. Suspension is a
      -- specific state, and the alert below says so.
      (SELECT count(*) FROM companies WHERE status = 'suspended')::int             AS suspended,
      (SELECT count(*) FROM users)::int                                            AS total_users,
      (SELECT count(*) FROM users WHERE updated_at >= CURRENT_DATE)::int           AS active_today,
      (SELECT count(*) FROM companies
        WHERE subscription_status = 'trial'
          AND trial_ends_at IS NOT NULL
          AND trial_ends_at BETWEEN now() AND now() + interval '7 days')::int      AS trials_expiring,
      (SELECT count(*) FROM companies
        WHERE subscription_status = 'active'
          AND current_period_end IS NOT NULL
          AND current_period_end BETWEEN now() AND now() + interval '7 days')::int AS subs_expiring
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    companies: {
      total: int(row.total),
      active: int(row.active),
      trial: int(row.trial),
      suspended: int(row.suspended),
    },
    users: { total: int(row.total_users), activeToday: int(row.active_today) },
    alerts: {
      trialsExpiring: int(row.trials_expiring),
      subscriptionsExpiring: int(row.subs_expiring),
      critical: int(row.suspended),
    },
  };
}

/** The subscription pie: one slice per plan, with its share and colour. */
export async function getSubscriptionDistribution() {
  const rows = (await privilegedDb().execute(sql`
    SELECT COALESCE(NULLIF(plan, ''), 'free') AS plan, count(*)::int AS n
      FROM companies
     GROUP BY 1
     ORDER BY n DESC
  `)) as unknown as Array<{ plan: string; n: number }>;

  const total = rows.reduce((s, r) => s + int(r.n), 0);
  return rows.map((r) => ({
    name: r.plan,
    value: int(r.n),
    percentage: total > 0 ? Math.round((int(r.n) / total) * 100) : 0,
    color: PLAN_COLORS[r.plan] ?? "#6b7280",
  }));
}

/** Trials and paid subscriptions running out within the week. */
export async function getExpiringCompanies() {
  const db = privilegedDb();
  const [trials, subs] = await Promise.all([
    db.execute(sql`
      SELECT id, name, slug, trial_ends_at
        FROM companies
       WHERE subscription_status = 'trial'
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at BETWEEN now() AND now() + interval '7 days'
       ORDER BY trial_ends_at
    `) as unknown as Promise<Array<Record<string, unknown>>>,
    db.execute(sql`
      SELECT id, name, slug, plan, current_period_end
        FROM companies
       WHERE subscription_status = 'active'
         AND current_period_end IS NOT NULL
         AND current_period_end BETWEEN now() AND now() + interval '7 days'
       ORDER BY current_period_end
    `) as unknown as Promise<Array<Record<string, unknown>>>,
  ]);

  return {
    trials: (await trials).map((c) => ({
      _id: String(c.id),
      name: String(c.name),
      slug: String(c.slug),
      daysRemaining: formatDaysRemaining(c.trial_ends_at),
    })),
    subscriptions: (await subs).map((c) => ({
      _id: String(c.id),
      name: String(c.name),
      slug: String(c.slug),
      plan: String(c.plan ?? "free"),
      daysRemaining: formatDaysRemaining(c.current_period_end),
    })),
  };
}

/**
 * Monthly recurring revenue, and the month-on-month trend.
 *
 * Priced from the plan each company is ON, not from anything billed — there is
 * no billing table yet, and the Mongo version did the same. When invoicing for
 * subscriptions exists this should read that instead, and the number will stop
 * being an estimate.
 */
export async function getMRRMetrics() {
  const rows = (await privilegedDb().execute(sql`
    SELECT COALESCE(NULLIF(plan, ''), 'free') AS plan,
           count(*)::int AS n,
           count(*) FILTER (WHERE created_at < date_trunc('month', CURRENT_DATE))::int AS n_last_month
      FROM companies
     WHERE subscription_status IN ('active', 'trial')
     GROUP BY 1
  `)) as unknown as Array<Record<string, unknown>>;

  const mrr = (key: "n" | "n_last_month") =>
    rows.reduce((s, r) => s + (PLAN_PRICING[String(r.plan)] ?? 0) * int(r[key]), 0);

  const current = mrr("n");
  const previous = mrr("n_last_month");

  return {
    current,
    // Against a zero base a percentage is undefined, not infinite.
    trend: previous ? ((current - previous) / previous) * 100 : 0,
    breakdown: rows.map((r) => ({
      plan: String(r.plan),
      count: int(r.n),
      revenue: (PLAN_PRICING[String(r.plan)] ?? 0) * int(r.n),
    })),
  };
}

/**
 * Health of each company, scored out of five.
 *
 * The scoring is carried over unchanged: two points for being active, two for
 * a live subscription (one for a trial), one for having any users at all.
 */
export async function getCompanyHealthOverview(limit = 10) {
  return companyHealth(limit, false);
}

/** The same, with revenue per company from the ledger. */
export async function getCompanyHealthWithRevenue(limit = 10) {
  return companyHealth(limit, true);
}

async function companyHealth(limit: number, withRevenue: boolean) {
  const rows = (await privilegedDb().execute(sql`
    SELECT c.id, c.name, c.slug, c.status, c.subscription_status, c.plan,
           (SELECT count(*) FROM user_company_access a
             WHERE a.company_id = c.id AND a.status = 'active')::int AS user_count,
           ${
             withRevenue
               ? sql`(SELECT COALESCE(SUM(l.credit - l.debit), 0)
                        FROM journal_entries e
                        JOIN journal_lines l ON l.entry_id = e.id
                        JOIN accounts ac ON ac.id = l.account_id
                       WHERE e.company_id = c.id AND e.status = 'posted'
                         AND ac.account_type = 'revenue')::numeric(19,4)`
               : sql`0::numeric(19,4)`
           } AS revenue
      FROM companies c
     ORDER BY c.created_at DESC
     LIMIT ${Math.min(limit, 100)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((c) => {
    let health = 0;
    if (c.status === "active") health += 2;
    else if (c.status === "inactive") health += 1;
    if (c.subscription_status === "active") health += 2;
    else if (c.subscription_status === "trial") health += 1;
    if (int(c.user_count) > 0) health += 1;

    return {
      _id: String(c.id),
      name: String(c.name),
      slug: String(c.slug),
      status: String(c.status ?? "active"),
      subscriptionStatus: String(c.subscription_status ?? "none"),
      plan: String(c.plan ?? "free"),
      userCount: int(c.user_count),
      ...(withRevenue ? { revenue: int(c.revenue) } : {}),
      health,
    };
  });
}

/** New companies and new users, most recent first, as an activity feed. */
export async function getRecentPlatformActivity(limit = 10) {
  const rows = (await privilegedDb().execute(sql`
    SELECT 'company' AS kind, name AS label, created_at FROM companies
    UNION ALL
    SELECT 'user' AS kind, name AS label, created_at FROM users
     ORDER BY created_at DESC
     LIMIT ${Math.min(limit, 50)}
  `)) as unknown as Array<Record<string, unknown>>;

  const relative = (d: unknown) => {
    const diff = Date.now() - new Date(d as string).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  };

  return rows.map((r) => ({
    type: String(r.kind),
    message:
      r.kind === "company"
        ? `New company: ${r.label}`
        : `New user: ${r.label}`,
    timestamp: new Date(r.created_at as string).toISOString(),
    relativeTime: relative(r.created_at),
  }));
}

/**
 * Thirty days of platform activity for the chart.
 *
 * Zero-filled from a generated series, so a quiet day is a zero rather than a
 * missing point — the Mongo version built the same skeleton in JavaScript.
 */
export async function getPlatformActivityChart() {
  const rows = (await privilegedDb().execute(sql`
    WITH series AS (
      SELECT generate_series(CURRENT_DATE - 29, CURRENT_DATE, '1 day')::date AS day
    )
    SELECT to_char(s.day, 'YYYY-MM-DD') AS date,
           to_char(s.day, 'Mon DD')     AS label,
           (SELECT count(*) FROM users u
             WHERE u.created_at::date = s.day)::int              AS new_users,
           (SELECT count(*) FROM users u
             WHERE u.updated_at::date = s.day)::int              AS active_sessions,
           (SELECT count(*) FROM journal_entries e
             WHERE e.entry_date = s.day AND e.status = 'posted')::int AS transactions
      FROM series s
     ORDER BY s.day
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    date: String(r.date),
    label: String(r.label),
    newUsers: int(r.new_users),
    activeSessions: int(r.active_sessions),
    transactions: int(r.transactions),
  }));
}

/** The banner alerts: suspensions, imminent trial expiry, seat limits. */
export async function getSystemAlerts() {
  const [row] = (await privilegedDb().execute(sql`
    SELECT
      (SELECT count(*) FROM companies WHERE status = 'suspended')::int AS suspended,
      (SELECT count(*) FROM companies
        WHERE subscription_status = 'trial'
          AND trial_ends_at IS NOT NULL
          AND trial_ends_at BETWEEN now() AND now() + interval '3 days')::int AS trials_3d,
      (SELECT count(*) FROM companies c
        WHERE c.max_users IS NOT NULL AND c.max_users > 0
          AND (SELECT count(*) FROM user_company_access a
                WHERE a.company_id = c.id AND a.status = 'active') >= c.max_users)::int AS at_limit
  `)) as unknown as Array<Record<string, unknown>>;

  const alerts: Array<{
    type: string;
    icon: string;
    message: string;
    count: number;
  }> = [];

  const suspended = int(row.suspended);
  if (suspended > 0) {
    alerts.push({
      type: "critical",
      icon: "🔴",
      message: `${suspended} ${suspended === 1 ? "company" : "companies"} suspended`,
      count: suspended,
    });
  }

  const trials = int(row.trials_3d);
  if (trials > 0) {
    alerts.push({
      type: "warning",
      icon: "🟡",
      message: `${trials} ${trials === 1 ? "trial" : "trials"} expiring within 3 days`,
      count: trials,
    });
  }

  const atLimit = int(row.at_limit);
  if (atLimit > 0) {
    alerts.push({
      type: "warning",
      icon: "🟡",
      message: `${atLimit} ${atLimit === 1 ? "company" : "companies"} at user limit`,
      count: atLimit,
    });
  }

  return alerts;
}
