/**
 * Integration tests for the notification bell against a real PostgreSQL.
 *
 * The module moved because it was throwing on every dashboard render — see
 * 0074. Most of what matters here is scoping: the bell must show one person
 * their own rows, and "their own" is not the same as "their company's", which
 * is all RLS gives you.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as notifications from "@/app/db/repositories/notifications";
import * as usersRepo from "@/app/db/repositories/users";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

async function expectRejection(promise, pattern) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to be rejected").toBeDefined();
  expect(`${caught.message} ${caught.cause ?? ""}`).toMatch(pattern);
}

suite("postgres notifications", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let asha;
  let brian;

  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

  const inA = (fn) => asTenant(companyA, fn);

  const bell = (userId, over = {}) => ({
    companyId: companyA,
    userId,
    type: "approval_request",
    title: "APR-0001 needs your approval",
    body: "Price change — Widget",
    href: "/dashboard/approvals",
    ...over,
  });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    // `users` explicitly: a cascade from companies does not reach it, because
    // users.home_company_id is ON DELETE SET NULL.
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;

    companyA = randomUUID();
    asha = "user-" + randomUUID().slice(0, 8);
    brian = "user-" + randomUUID().slice(0, 8);

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})`;

    await admin`
      INSERT INTO users (id, home_company_id, name, email, role, status)
      VALUES (${asha},  ${companyA}, 'Asha Wanjiru', ${asha + "@x.test"},  'Accountant', 'active'),
             (${brian}, ${companyA}, 'Brian Otieno', ${brian + "@x.test"}, 'Manager',    'active')`;

    /**
     * BOTH NEED A GRANT TO BE VISIBLE AT ALL.
     *
     * `users` carries a `visible_within_company` policy: a row is selectable
     * only when that person holds an ACTIVE grant in the company the request
     * is scoped to. `home_company_id` is not membership — the grant is. A
     * fixture that sets only the home company makes the user invisible, which
     * is how the first version of this file "proved" that listUsersByRole
     * missed somebody it had in fact correctly excluded.
     *
     * Left NULL so `COALESCE(a.role, u.role)` falls through to the global role;
     * the test below overrides one to prove the grant wins.
     */
    await admin`
      INSERT INTO user_company_access (user_id, company_id, role, status)
      VALUES (${asha}, ${companyA}, NULL, 'active'),
             (${brian}, ${companyA}, NULL, 'active')`;
  });

  describe("the bell", () => {
    it("returns my latest rows and my unread count in one call", async () => {
      await inA((tx) =>
        notifications.createMany(tx, [
          bell(asha, { title: "First" }),
          bell(asha, { title: "Second" }),
          bell(brian, { title: "Not mine" }),
        ]),
      );

      const mine = await inA((tx) => notifications.listForUser(tx, asha));
      expect(mine.items).toHaveLength(2);
      expect(mine.unread).toBe(2);
      expect(mine.items.map((i) => i.title).sort()).toEqual(["First", "Second"]);

      const theirs = await inA((tx) => notifications.listForUser(tx, brian));
      expect(theirs.items).toHaveLength(1);
      expect(theirs.items[0].title).toBe("Not mine");
    });

    it("counts ALL my unread, not just the ones on the page", async () => {
      // The badge says "8 unread" while the list shows three items. Those are
      // different questions, and a count taken from the page answers the wrong
      // one.
      await inA((tx) =>
        notifications.createMany(
          tx,
          Array.from({ length: 8 }, (_, i) => bell(asha, { title: `N-${i}` })),
        ),
      );

      const page = await inA((tx) => notifications.listForUser(tx, asha, 3));
      expect(page.items).toHaveLength(3);
      expect(page.unread).toBe(8);
    });

    it("reports zero rather than undefined when there is nothing", async () => {
      // With no rows the window subquery never runs, so the count has to come
      // from somewhere else.
      const empty = await inA((tx) => notifications.listForUser(tx, asha));
      expect(empty.items).toEqual([]);
      expect(empty.unread).toBe(0);
    });

    it("shows newest first", async () => {
      await inA((tx) => notifications.createMany(tx, [bell(asha, { title: "older" })]));
      await admin`UPDATE notifications SET created_at = now() - interval '1 day'`;
      await inA((tx) => notifications.createMany(tx, [bell(asha, { title: "newer" })]));

      const { items } = await inA((tx) => notifications.listForUser(tx, asha));
      expect(items.map((i) => i.title)).toEqual(["newer", "older"]);
    });

    it("serialises the shape the bell component destructures", async () => {
      await inA((tx) => notifications.createMany(tx, [bell(asha)]));
      const [item] = (await inA((tx) => notifications.listForUser(tx, asha))).items;

      expect(item._id).toMatch(/^[0-9a-f-]{36}$/);
      expect(item.type).toBe("approval_request");
      expect(item.title).toBe("APR-0001 needs your approval");
      expect(item.body).toBe("Price change — Widget");
      expect(item.href).toBe("/dashboard/approvals");
      expect(item.read).toBe(false);
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("gives a missing body and href as empty strings, not null", async () => {
      // The component renders {n.body} directly; null would print nothing but
      // the Mongo version coerced, and the bell was built against that.
      await inA((tx) =>
        notifications.createMany(tx, [
          bell(asha, { body: null, href: null, type: "system" }),
        ]),
      );
      const [item] = (await inA((tx) => notifications.listForUser(tx, asha))).items;
      expect(item.body).toBe("");
      expect(item.href).toBe("");
    });
  });

  describe("marking read", () => {
    it("stamps one of mine and drops it out of the count", async () => {
      await inA((tx) =>
        notifications.createMany(tx, [bell(asha, { title: "A" }), bell(asha, { title: "B" })]),
      );
      const { items } = await inA((tx) => notifications.listForUser(tx, asha));

      expect(await inA((tx) => notifications.markRead(tx, asha, items[0]._id))).toBe(true);

      const after = await inA((tx) => notifications.listForUser(tx, asha));
      expect(after.unread).toBe(1);
      expect(after.items).toHaveLength(2); // still listed, just read
      expect(after.items.find((i) => i._id === items[0]._id).read).toBe(true);
    });

    it("REFUSES to mark somebody else's, even inside the same company", async () => {
      // RLS scopes this to the tenant, which is not the same as scoping it to
      // the recipient. Without user_id in the WHERE, any colleague could clear
      // another person's bell by id.
      await inA((tx) => notifications.createMany(tx, [bell(brian)]));
      const { items } = await inA((tx) => notifications.listForUser(tx, brian));

      expect(await inA((tx) => notifications.markRead(tx, asha, items[0]._id))).toBe(false);
      expect((await inA((tx) => notifications.listForUser(tx, brian))).unread).toBe(1);
    });

    it("does not re-stamp one already read, so read_at stays first-seen", async () => {
      await inA((tx) => notifications.createMany(tx, [bell(asha)]));
      const { items } = await inA((tx) => notifications.listForUser(tx, asha));
      await inA((tx) => notifications.markRead(tx, asha, items[0]._id));

      const [{ read_at: first }] = await admin`SELECT read_at FROM notifications`;
      expect(await inA((tx) => notifications.markRead(tx, asha, items[0]._id))).toBe(false);
      const [{ read_at: second }] = await admin`SELECT read_at FROM notifications`;
      expect(second).toEqual(first);
    });

    it("marks all of mine and none of theirs", async () => {
      await inA((tx) =>
        notifications.createMany(tx, [bell(asha), bell(asha), bell(brian)]),
      );

      expect(await inA((tx) => notifications.markAllRead(tx, asha))).toBe(2);
      expect((await inA((tx) => notifications.listForUser(tx, asha))).unread).toBe(0);
      expect((await inA((tx) => notifications.listForUser(tx, brian))).unread).toBe(1);
    });
  });

  describe("what the column refuses", () => {
    it("refuses an absolute href, so the bell cannot become an open redirect", async () => {
      await expectRejection(
        inA((tx) =>
          notifications.createMany(tx, [bell(asha, { href: "https://evil.test/steal" })]),
        ),
        /href_is_relative/i,
      );
      // A protocol-relative URL is absolute too, and looks relative.
      await expectRejection(
        inA((tx) => notifications.createMany(tx, [bell(asha, { href: "//evil.test" })])),
        /href_is_relative/i,
      );
    });

    it("refuses an over-long title or body", async () => {
      await expectRejection(
        inA((tx) => notifications.createMany(tx, [bell(asha, { title: "x".repeat(201) })])),
        /title_length/i,
      );
      await expectRejection(
        inA((tx) => notifications.createMany(tx, [bell(asha, { body: "x".repeat(501) })])),
        /body_length/i,
      );
    });

    it("refuses a recipient who does not exist", async () => {
      await expectRejection(
        inA((tx) => notifications.createMany(tx, [bell("user-nobody")])),
        /user_id/i,
      );
    });

    it("writes nothing at all for an empty fan-out", async () => {
      // A UNION of no branches is a syntax error; so is INSERT ... VALUES with
      // nothing after it.
      expect(await inA((tx) => notifications.createMany(tx, []))).toBe(0);
    });
  });

  describe("the 90-day sweep", () => {
    it("removes what has expired and keeps what has not", async () => {
      await inA((tx) =>
        notifications.createMany(tx, [bell(asha, { title: "old" }), bell(asha, { title: "new" })]),
      );
      await admin`
        UPDATE notifications SET created_at = now() - interval '91 days'
         WHERE title = 'old'`;

      expect(await inA((tx) => notifications.deleteOlderThan(tx, 90))).toBe(1);
      const { items } = await inA((tx) => notifications.listForUser(tx, asha));
      expect(items.map((i) => i.title)).toEqual(["new"]);
    });

    it("keeps a read one that is still inside the window", async () => {
      // Mongo's TTL expired on age alone, not on read state. Same here: a row
      // read yesterday is not rubbish today.
      await inA((tx) => notifications.createMany(tx, [bell(asha)]));
      await inA((tx) => notifications.markAllRead(tx, asha));
      expect(await inA((tx) => notifications.deleteOlderThan(tx, 90))).toBe(0);
    });
  });

  describe("who the approvers are", () => {
    it("resolves the role from the GRANT, not the global users row", async () => {
      // Brian is a Manager globally and an Accountant in THIS company. Picking
      // approvers off users.role would notify him about the wrong company's
      // requests and miss him for this one's.
      await admin`
        UPDATE user_company_access SET role = 'Accountant'
         WHERE user_id = ${brian} AND company_id = ${companyA}`;

      const accountants = await inA((tx) => usersRepo.listUsersByRole(tx, ["Accountant"]));
      expect(accountants.map((u) => u.id).sort()).toEqual([asha, brian].sort());

      const managers = await inA((tx) => usersRepo.listUsersByRole(tx, ["Manager"]));
      expect(managers).toHaveLength(0);
    });

    it("skips a login that is not active", async () => {
      await admin`UPDATE users SET status = 'inactive' WHERE id = ${asha}`;
      const found = await inA((tx) => usersRepo.listUsersByRole(tx, ["Accountant"]));
      expect(found.map((u) => u.id)).not.toContain(asha);
    });

    it("returns nothing for an empty role list rather than everybody", async () => {
      expect(await inA((tx) => usersRepo.listUsersByRole(tx, []))).toEqual([]);
    });
  });

  it("hides another tenant's notifications", async () => {
    await inA((tx) => notifications.createMany(tx, [bell(asha)]));

    const companyB = randomUUID();
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})`;

    // Same user id, different company: the bell is per-tenant.
    const seen = await asTenant(companyB, (tx) => notifications.listForUser(tx, asha));
    expect(seen.items).toEqual([]);
    expect(seen.unread).toBe(0);
  });
});
