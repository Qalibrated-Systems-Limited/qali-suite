/**
 * Keeping an existing chart of accounts up to date.
 *
 * The last three `settings` screens. Two of them pressed buttons that wrote
 * MONGO `Account` documents while every account screen has read Postgres since
 * §9C: "Sync complete — created 12 accounts" and the chart of accounts page
 * showed exactly what it had before. The §9E defect, in Settings.
 *
 * A sync is a dangerous shape to get wrong, because it runs against a chart
 * somebody has been using. Most of what is asserted here is what it must NOT
 * do: not re-parent, not demote, not clobber a handle, not restructure.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const accountsRepo = await import("@/app/db/repositories/accounts");
const { getStandardChartOfAccounts } = await import("@/lib/chart-of-accounts");

const DEFINITIONS = getStandardChartOfAccounts();
const codeOf = (systemAccount) =>
  DEFINITIONS.find((d) => d.systemAccount === systemAccount)?.accountCode;

suite("keeping a chart of accounts up to date", () => {
  let admin, client, db;
  let companyA, companyB;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const sync = (defs = DEFINITIONS, companyId = companyA) =>
    asTenant(companyId, (tx) =>
      accountsRepo.syncStandardChart(tx, companyId, defs, { id: null }),
    );

  const account = (code, companyId = companyA) =>
    asTenant(companyId, async (tx) => {
      const [r] = await tx.execute(sql`
        SELECT id::text, account_code, account_name, account_type, sub_type,
               parent_id::text, path::text AS path, level, can_post, system_account
          FROM accounts WHERE account_code = ${code}`);
      return r ?? null;
    });

  const countAccounts = (companyId = companyA) =>
    asTenant(companyId, async (tx) => {
      const [r] = await tx.execute(sql`SELECT COUNT(*)::int AS n FROM accounts`);
      return r.n;
    });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("it writes to the store the screens read", () => {
    it("creates the whole standard chart for a company that has none", async () => {
      // The headline defect: the Mongo action created Mongo Account documents
      // and reported success, while /dashboard/accounts read Postgres.
      expect(await countAccounts()).toBe(0);

      const result = await sync();

      expect(result.created).toHaveLength(DEFINITIONS.length);
      expect(await countAccounts()).toBe(DEFINITIONS.length);
    });

    it("is idempotent — a second run creates nothing", async () => {
      await sync();
      const again = await sync();
      expect(again.created).toHaveLength(0);
      expect(again.tagged).toBe(0);
      expect(await countAccounts()).toBe(DEFINITIONS.length);
    });

    it("creates only what is missing, leaving the rest alone", async () => {
      await sync();
      // A leaf with no system handle: `accounts` has a trigger refusing to
      // delete a system account, which is why this is not the AR control.
      const plain = DEFINITIONS.find(
        (d) => !d.systemAccount && d.subType !== "header" && d.parentCode,
      );
      await admin`DELETE FROM accounts
                   WHERE company_id = ${companyA}
                     AND account_code = ${plain.accountCode}`;

      const result = await sync();
      expect(result.created.map((c) => c.accountCode)).toEqual([
        plain.accountCode,
      ]);
    });

    it("does not touch another company's chart", async () => {
      await sync();
      expect(await countAccounts(companyB)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the hierarchy", () => {
    it("gives a created account its parent, and demotes that parent", async () => {
      const advanceCode = codeOf("supplier_advance"); // 1170, under 1100
      const parentCode = DEFINITIONS.find(
        (d) => d.accountCode === advanceCode,
      ).parentCode;

      await sync();
      const child = await account(advanceCode);
      const parent = await account(parentCode);

      expect(child.parent_id).toBe(parent.id);
      expect(parent.can_post).toBe(false);
    });

    it("materialises the ltree path, which provisioning never did", async () => {
      // `getDescendants()` walks `path <@ path`, and a NULL path matches
      // nothing — so a chart with no paths cannot be walked at all.
      await sync();
      const advanceCode = codeOf("supplier_advance");
      const child = await account(advanceCode);
      expect(child.path).toBeTruthy();
      expect(child.path.endsWith(advanceCode)).toBe(true);
      expect(child.level).toBeGreaterThan(0);
    });

    it("REPAIRS a NULL path on an account it did not create", async () => {
      await sync();
      const advanceCode = codeOf("supplier_advance");
      await admin`UPDATE accounts SET path = NULL, level = 0
                   WHERE company_id = ${companyA} AND account_code = ${advanceCode}`;
      expect((await account(advanceCode)).path).toBeNull();

      const result = await sync();
      expect(result.created).toHaveLength(0);
      expect(result.rewired).toBeGreaterThan(0);

      const repaired = await account(advanceCode);
      expect(repaired.path).toBeTruthy();
      expect(repaired.level).toBeGreaterThan(0);
    });

    it("makes getDescendants work, which is the point of the path", async () => {
      await sync();
      const parentCode = DEFINITIONS.find(
        (d) => d.accountCode === codeOf("supplier_advance"),
      ).parentCode;
      const parent = await account(parentCode);

      const kids = await inA((tx) => accountsRepo.getDescendants(tx, parent.id));
      expect(kids.length).toBeGreaterThan(0);
    });

    it("does NOT re-parent an account somebody moved deliberately", async () => {
      // A sync fills gaps. Forcing every seed code back under the seed's
      // parent would restructure a chart a company arranged on purpose, and
      // demote accounts they post to into headers on the way.
      await sync();
      const advanceCode = codeOf("supplier_advance");
      const equityRoot = DEFINITIONS.find((d) => !d.parentCode).accountCode;
      const root = await account(equityRoot);

      await admin`UPDATE accounts SET parent_id = ${root.id}
                   WHERE company_id = ${companyA} AND account_code = ${advanceCode}`;

      await sync();
      expect((await account(advanceCode)).parent_id).toBe(root.id);
    });

    it("does NOT demote an account a company decided to post to", async () => {
      await sync();
      const parentCode = DEFINITIONS.find(
        (d) => d.accountCode === codeOf("supplier_advance"),
      ).parentCode;
      await admin`UPDATE accounts SET can_post = true
                   WHERE company_id = ${companyA} AND account_code = ${parentCode}`;

      await sync();
      expect((await account(parentCode)).can_post).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the system handles", () => {
    it("backfills a handle the seed defines and the row is missing", async () => {
      // A company onboarded before a tag was added keeps failing posting
      // lookups, and the create pass skips it because the code is present.
      await sync();
      const arCode = codeOf("accounts_receivable");
      await admin`UPDATE accounts SET system_account = NULL
                   WHERE company_id = ${companyA} AND account_code = ${arCode}`;

      const result = await sync();
      expect(result.tagged).toBe(1);
      expect((await account(arCode)).system_account).toBe("accounts_receivable");
    });

    it("NEVER clobbers a handle somebody already set", async () => {
      await sync();
      const arCode = codeOf("accounts_receivable");
      // A handle no seed account claims: `accounts_company_system_uq` is a
      // partial UNIQUE, so borrowing a real one collides in the fixture
      // rather than testing anything.
      await admin`UPDATE accounts SET system_account = 'their_own_handle'
                   WHERE company_id = ${companyA} AND account_code = ${arCode}`;

      await sync();
      expect((await account(arCode)).system_account).toBe("their_own_handle");
    });

    it("does not fight a handle another account already claims", async () => {
      // `accounts_company_system_uq` is a partial UNIQUE. A blind backfill
      // aborts the WHOLE sync on the first company that tagged its own
      // account — losing every other repair in the same transaction.
      await sync();
      const arCode = codeOf("accounts_receivable");

      // Somebody's own account carries the handle; the standard one has none.
      await admin`UPDATE accounts SET system_account = NULL
                   WHERE company_id = ${companyA} AND account_code = ${arCode}`;
      const spare = randomUUID();
      await admin`INSERT INTO accounts (id, company_id, account_code, account_name,
                                        account_type, system_account)
                  VALUES (${spare}, ${companyA}, '1129', 'Debtors (ours)', 'asset',
                          'accounts_receivable')`;

      const result = await sync();
      expect(result.tagged).toBe(0);
      expect((await account(arCode)).system_account).toBeNull();
      // And the run completed rather than aborting on the collision.
      expect(result.created).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the advance accounts, on their own", () => {
    const subset = () => {
      const wanted = new Set(["supplier_advance", "customer_advance"]);
      const targets = DEFINITIONS.filter((a) => wanted.has(a.systemAccount ?? ""));
      const parentCodes = new Set(targets.map((a) => a.parentCode).filter(Boolean));
      return DEFINITIONS.filter(
        (a) => wanted.has(a.systemAccount ?? "") || parentCodes.has(a.accountCode),
      );
    };

    it("creates the pair and the parents they hang from, and nothing else", async () => {
      const result = await sync(subset());
      const codes = result.created.map((c) => c.accountCode).sort();
      expect(codes).toEqual(subset().map((a) => a.accountCode).sort());
      expect(await countAccounts()).toBe(subset().length);
    });

    it("reports the pair as present once they exist", async () => {
      expect((await inA((tx) => accountsRepo.getAdvanceAccountStatus(tx))).complete)
        .toBe(false);

      await sync(subset());

      const status = await inA((tx) => accountsRepo.getAdvanceAccountStatus(tx));
      expect(status.complete).toBe(true);
      expect(status.accounts.map((a) => a.handle).sort()).toEqual([
        "customer_advance",
        "supplier_advance",
      ]);
      expect(status.accounts.every((a) => a.exists)).toBe(true);
    });

    it("names which one is missing when only one is there", async () => {
      await sync(subset());
      // Untag before deleting: a system account is protected by a trigger,
      // which is the guard this fixture has to step around rather than fight.
      await admin`UPDATE accounts SET system_account = NULL
                   WHERE company_id = ${companyA}
                     AND system_account = 'customer_advance'`;
      await admin`DELETE FROM accounts
                   WHERE company_id = ${companyA}
                     AND account_code = ${codeOf("customer_advance")}`;

      const status = await inA((tx) => accountsRepo.getAdvanceAccountStatus(tx));
      expect(status.complete).toBe(false);
      expect(
        status.accounts.filter((a) => !a.exists).map((a) => a.label),
      ).toEqual(["Customer Advance"]);
    });

    it("READS. The status check must not create anything", async () => {
      // The card called `ensureAdvanceAccountsExist()` from a mount effect —
      // an action that creates the accounts — so opening the settings page
      // wrote to the chart of accounts, every time.
      const before = await countAccounts();
      await inA((tx) => accountsRepo.getAdvanceAccountStatus(tx));
      expect(await countAccounts()).toBe(before);
      expect(before).toBe(0);
    });
  });
});
