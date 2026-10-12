/**
 * Row-level security, audited — and demonstrated (0118).
 *
 * 0024 added `rls_coverage_gaps` and said the gaps it lists are "worth
 * asserting in CI and before cutover — every gap above existed because a table
 * was added outside the loop that enables the policies, and nothing was
 * watching." Nothing then watched. This is that assertion.
 *
 * It is two tests on purpose, and the second is the one that matters.
 *
 * The audit is metadata: it reads pg_class and answers "is this object
 * configured to be protected". That is worth having, and it is exactly the
 * kind of check that goes green while the thing it describes is untrue —
 * fifteen views were configured in a way the audit did not look at, because
 * the audit filtered `relkind = 'r'` and a view is `'v'`.
 *
 * So the second test does not ask the catalogue anything. It writes two
 * companies' rows, connects as the application role scoped to one of them, and
 * reads a view. A leak shows up as the other company's name in the result,
 * which is the form the report would take if a customer found it.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("row-level security coverage", () => {
  let admin;
  let app;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    // The APPLICATION role — NOSUPERUSER, NOBYPASSRLS (0023). Connecting as
    // the superuser here would make every assertion below pass vacuously.
    app = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    if (admin) await admin.end();
    if (app) await app.end();
  });

  it("has no object carrying tenant data without protection", async () => {
    const gaps = await admin`
      SELECT table_name, object_kind, rls_enabled, rls_forced,
             has_policy, security_invoker
        FROM rls_coverage_gaps
       ORDER BY table_name`;

    // Named rather than counted: a failure should say WHICH object and what it
    // is missing, because the fix differs — a table needs a policy, a view
    // needs `security_invoker`.
    expect(gaps.map((g) => `${g.table_name} (${g.object_kind})`)).toEqual([]);
  });

  it("does not serve one tenant's rows through a view to another", async () => {
    const alpha = randomUUID();
    const bravo = randomUUID();

    await admin`TRUNCATE companies CASCADE`;
    for (const [id, name] of [
      [alpha, "Alpha Ltd"],
      [bravo, "Bravo Ltd"],
    ]) {
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${id}, ${name}, ${"s-" + id.slice(0, 8)})`;
      await admin`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
        VALUES (${randomUUID()}, ${id}, '1300', ${name + " Inventory"}, 'asset')`;
    }

    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${alpha}, true)`;

      // The base table has always been right; it is here as the control, so a
      // failure below cannot be blamed on the fixture or the scoping.
      const base = await tx`SELECT account_name FROM accounts ORDER BY 1`;
      expect(base.map((r) => r.account_name)).toEqual(["Alpha Ltd Inventory"]);

      // `account_balances` is a view over it. Before 0118 this returned both.
      const view = await tx`
        SELECT account_name FROM account_balances ORDER BY 1`;
      expect(view.map((r) => r.account_name)).toEqual(["Alpha Ltd Inventory"]);
    });

    await admin`TRUNCATE companies CASCADE`;
  });
});
