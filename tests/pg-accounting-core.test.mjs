/**
 * Integration tests for the Postgres accounting core.
 *
 * These run the real repositories against a real PostgreSQL, so they cover the
 * parts unit tests cannot: RLS policies, the deferred balance trigger, the
 * fiscal-period guard, and the views.
 *
 * Skipped unless DATABASE_URL is set, so the normal suite stays runnable
 * without a database:
 *
 *   docker run -d --name stockvault-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=stockvault -p 5433:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/stockvault \
 *     npx vitest run tests/pg-accounting-core.test.mjs
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
/**
 * The privileged connection: CREATE ROLE, GRANT, TRUNCATE. The app's own
 * DATABASE_URL connects as app_user, which has none of those by design — see
 * migration 0023. Falls back to DATABASE_URL for a single-role local setup.
 */
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("postgres accounting core", () => {
  let sql; // connects as a NON-superuser; subject to RLS
  let admin; // superuser; setup/teardown only
  let companyA;
  let companyB;
  let cash;
  let sales;
  let ar;

  /** Runs `fn` with RLS scoped to one tenant, exactly as withTenant() does. */
  async function asTenant(companyId, fn) {
    return sql.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyId}, true)`;
      return fn(tx);
    });
  }

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });

    // A SUPERUSER bypasses RLS even with FORCE ROW LEVEL SECURITY, so testing
    // isolation over the default `postgres` role would silently pass no matter
    // what the policies said. Production must connect as a restricted role for
    // the same reason.

    // Restricted role provisioned once by tests/setup.global.mjs.
    sql = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    if (sql) await sql.end();
    if (admin) {
      await admin.end();
    }
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;

    companyA = randomUUID();
    companyB = randomUUID();
    cash = randomUUID();
    sales = randomUUID();
    ar = randomUUID();

    // Creating a tenant is a platform operation, not a tenant one: companies
    // is RLS-scoped to app.company_id (migration 0024), so it goes via admin.
    await admin`
      INSERT INTO companies (id, name, slug) VALUES
        (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)}),
        (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${cash},  ${companyA}, '1000', 'Cash',        'asset',   'cash'),
          (${ar},    ${companyA}, '1100', 'Receivables', 'asset',   'accounts_receivable'),
          (${sales}, ${companyA}, '4000', 'Sales',       'revenue', NULL)
      `;
    });
  });

  /** Inserts a posted entry with two lines. Returns the entry id. */
  async function postEntry(tx, { companyId, number, date, debitAcct, creditAcct, debit, credit, party }) {
    const id = randomUUID();
    await tx`
      INSERT INTO journal_entries (
        id, company_id, entry_number, entry_date, entry_type, description, status,
        party_type, party_id, due_date, is_fully_paid
      ) VALUES (
        ${id}, ${companyId}, ${number}, ${date}, 'sale', 'test entry', 'posted',
        ${party?.type ?? null}, ${party?.id ?? null}, ${party?.dueDate ?? null},
        ${party ? false : true}
      )
    `;
    await tx`
      INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit) VALUES
        (${companyId}, ${id}, ${debitAcct},  1, ${debit},  '0'),
        (${companyId}, ${id}, ${creditAcct}, 2, '0',       ${credit})
    `;
    return id;
  }

  describe("balance invariant", () => {
    it("commits a balanced entry", async () => {
      await asTenant(companyA, (tx) =>
        postEntry(tx, {
          companyId: companyA, number: "JE-1", date: "2026-08-02",
          debitAcct: cash, creditAcct: sales, debit: "5000.0000", credit: "5000.0000",
        }),
      );

      const [{ count }] = await asTenant(
        companyA,
        (tx) => tx`SELECT count(*)::int AS count FROM journal_entries`,
      );
      expect(count).toBe(1);
    });

    it("rejects an entry that is off by a fraction of a cent", async () => {
      // 0.005 — under the Mongo layer's Math.abs(d - c) < 0.01 tolerance this
      // was considered balanced and would have posted.
      await expect(
        asTenant(companyA, (tx) =>
          postEntry(tx, {
            companyId: companyA, number: "JE-2", date: "2026-08-02",
            debitAcct: cash, creditAcct: sales, debit: "100.0000", credit: "99.9950",
          }),
        ),
      ).rejects.toThrow(/not balanced/i);
    });

    it("rejects a single-line posted entry", async () => {
      await expect(
        asTenant(companyA, async (tx) => {
          const id = randomUUID();
          await tx`
            INSERT INTO journal_entries (id, company_id, entry_number, entry_date, entry_type, description, status)
            VALUES (${id}, ${companyA}, 'JE-3', '2026-08-02', 'sale', 'one line', 'posted')
          `;
          await tx`
            INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
            VALUES (${companyA}, ${id}, ${cash}, 1, '100.0000', '0')
          `;
        }),
      ).rejects.toThrow(/at least 2 lines/i);
    });

    it("allows an unbalanced DRAFT", async () => {
      await asTenant(companyA, async (tx) => {
        const id = randomUUID();
        await tx`
          INSERT INTO journal_entries (id, company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${id}, ${companyA}, 'JE-D1', '2026-08-02', 'adjustment', 'wip', 'draft')
        `;
        await tx`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
          VALUES (${companyA}, ${id}, ${cash}, 1, '250.0000', '0')
        `;
      });

      const [{ count }] = await asTenant(
        companyA,
        (tx) => tx`SELECT count(*)::int AS count FROM journal_entries WHERE status = 'draft'`,
      );
      expect(count).toBe(1);
    });

    it("rejects a line carrying both a debit and a credit", async () => {
      await expect(
        asTenant(companyA, async (tx) => {
          const id = randomUUID();
          await tx`
            INSERT INTO journal_entries (id, company_id, entry_number, entry_date, entry_type, description, status)
            VALUES (${id}, ${companyA}, 'JE-4', '2026-08-02', 'sale', 'both sides', 'draft')
          `;
          await tx`
            INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
            VALUES (${companyA}, ${id}, ${cash}, 1, '100.0000', '100.0000')
          `;
        }),
      ).rejects.toThrow(/journal_lines_one_sided/i);
    });
  });

  describe("tenant isolation", () => {
    beforeEach(async () => {
      await asTenant(companyA, (tx) =>
        postEntry(tx, {
          companyId: companyA, number: "JE-1", date: "2026-08-02",
          debitAcct: cash, creditAcct: sales, debit: "5000.0000", credit: "5000.0000",
        }),
      );
    });

    it("hides another tenant's ledger", async () => {
      const rows = await asTenant(
        companyB,
        (tx) => tx`SELECT count(*)::int AS count FROM journal_entries`,
      );
      expect(rows[0].count).toBe(0);
    });

    it("refuses a write scoped to another tenant", async () => {
      await expect(
        asTenant(
          companyB,
          (tx) => tx`
            INSERT INTO accounts (company_id, account_code, account_name, account_type)
            VALUES (${companyA}, '9999', 'Injected', 'asset')
          `,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("does not carry tenant scope past COMMIT", async () => {
      await asTenant(companyA, (tx) => tx`SELECT 1`);
      // New transaction on the same pooled connection, no scope set.
      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM journal_entries
      `;
      expect(count).toBe(0);
    });
  });

  describe("derived balances", () => {
    it("computes balances and ties the trial balance", async () => {
      await asTenant(companyA, (tx) =>
        postEntry(tx, {
          companyId: companyA, number: "JE-1", date: "2026-08-02",
          debitAcct: cash, creditAcct: sales, debit: "5000.0000", credit: "5000.0000",
        }),
      );

      const balances = await asTenant(
        companyA,
        (tx) => tx`SELECT account_code, balance FROM account_balances ORDER BY account_code`,
      );
      const byCode = Object.fromEntries(balances.map((r) => [r.account_code, r.balance]));
      expect(byCode["1000"]).toBe("5000.0000");
      expect(byCode["4000"]).toBe("5000.0000");

      const [totals] = await asTenant(
        companyA,
        (tx) => tx`
          SELECT SUM(debit_balance) AS d, SUM(credit_balance) AS c FROM trial_balance
        `,
      );
      expect(totals.d).toBe(totals.c);
    });

    it("excludes draft entries from balances", async () => {
      await asTenant(companyA, async (tx) => {
        const id = randomUUID();
        await tx`
          INSERT INTO journal_entries (id, company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${id}, ${companyA}, 'JE-D1', '2026-08-02', 'adjustment', 'wip', 'draft')
        `;
        await tx`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit) VALUES
            (${companyA}, ${id}, ${cash},  1, '999.0000', '0'),
            (${companyA}, ${id}, ${sales}, 2, '0', '999.0000')
        `;
      });

      const [row] = await asTenant(
        companyA,
        (tx) => tx`SELECT balance FROM account_balances WHERE account_code = '1000'`,
      );
      expect(row.balance).toBe("0.0000");
    });
  });

  describe("guards", () => {
    it("refuses to delete a system account", async () => {
      await expect(
        asTenant(companyA, (tx) => tx`DELETE FROM accounts WHERE id = ${cash}`),
      ).rejects.toThrow(/system account/i);
    });

    it("blocks posting into a closed fiscal period", async () => {
      await asTenant(companyA, (tx) => tx`
        INSERT INTO fiscal_periods (company_id, year, month, period_name, period_code, start_date, end_date, status)
        VALUES (${companyA}, 2026, 8, 'August 2026', '2026-08', '2026-08-01', '2026-08-31', 'closed')
      `);

      await expect(
        asTenant(companyA, (tx) =>
          postEntry(tx, {
            companyId: companyA, number: "JE-9", date: "2026-08-15",
            debitAcct: cash, creditAcct: sales, debit: "10.0000", credit: "10.0000",
          }),
        ),
      ).rejects.toThrow(/closed fiscal period/i);
    });

    it("issues gapless per-tenant entry numbers", async () => {
      const numbers = await asTenant(companyA, async (tx) => {
        const out = [];
        for (let i = 0; i < 3; i++) {
          const [{ next_entry_number }] = await tx`
            SELECT next_entry_number(${companyA}::uuid, 'JE') AS next_entry_number
          `;
          out.push(next_entry_number);
        }
        return out;
      });
      expect(numbers).toEqual(["JE-00001", "JE-00002", "JE-00003"]);

      // A different tenant starts its own sequence at 1.
      const [{ next_entry_number }] = await asTenant(
        companyB,
        (tx) => tx`SELECT next_entry_number(${companyB}::uuid, 'JE') AS next_entry_number`,
      );
      expect(next_entry_number).toBe("JE-00001");
    });
  });

  describe("AR aging", () => {
    it("buckets an overdue receivable", async () => {
      const customer = randomUUID();
      // Since migration 0006 journal_entries.party_id carries a composite FK,
      // so the party must exist before an entry can name it.
      await asTenant(companyA, (tx) => tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}, ${companyA}, 'customer', true, 'Acme Ltd')
      `);
      await asTenant(companyA, (tx) =>
        postEntry(tx, {
          companyId: companyA, number: "JE-AR1", date: "2026-05-01",
          debitAcct: ar, creditAcct: sales, debit: "12000.0000", credit: "12000.0000",
          party: { type: "customer", id: customer, dueDate: "2026-06-20" },
        }),
      );

      // As at 2026-08-15 that invoice is 56 days overdue -> the 31-60 bucket.
      const rows = await asTenant(companyA, (tx) => tx`
        WITH target_account AS (SELECT id FROM accounts WHERE system_account = 'accounts_receivable'),
        aged AS (
          SELECT e.party_id, (l.debit - l.credit)::numeric(19,4) AS amount,
                 GREATEST(0, ('2026-08-15'::date - e.due_date)) AS days_overdue
            FROM journal_entries e
            JOIN journal_lines l ON l.entry_id = e.id
            JOIN target_account ta ON ta.id = l.account_id
           WHERE e.status = 'posted' AND e.party_type = 'customer' AND e.is_fully_paid = false
        )
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE days_overdue BETWEEN 31 AND 60), 0)::numeric(19,4) AS d31_60,
          COALESCE(SUM(amount), 0)::numeric(19,4) AS total
        FROM aged
      `);

      expect(rows[0].d31_60).toBe("12000.0000");
      expect(rows[0].total).toBe("12000.0000");
    });
  });
});
