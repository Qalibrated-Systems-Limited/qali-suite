/**
 * The number somebody is accountable for — 0097.
 *
 * `docs/CURRENT-STATE.md` lists KPIs as ✅ shipped. On this branch they were
 * shipped and WRONG: all nine auto formulas read Mongo collections — journal
 * entries, payroll runs, invoices, employees — that stopped receiving writes
 * when those modules ported. A KPI on `monthly_revenue` returned 0 and the
 * board painted it red, which is worse than an error because it looks like an
 * answer.
 *
 * So most of this file is not "does the transcription round-trip". It is
 * "does the formula produce the right number from the store that now holds
 * the data", plus the four rules the database enforces that the Mongo action
 * layer only asked nicely for.
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

const { userMessage } = await import("@/app/db/errors");
const kpis = await import("@/app/db/repositories/kpis");
const journal = await import("@/app/db/repositories/journal");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the number somebody is accountable for", () => {
  let admin, client, db;
  let companyA, companyB, customer;
  let cashAcct, bankAcct, arAcct, salesAcct, cogsAcct, materialsAcct, rentAcct;
  const actor = { id: null, name: "The CFO" };

  /** The period every formula test uses — a fixed month, never "now". */
  const Y = 2026;
  const M = 3;
  const on = (day, month = M, year = Y) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const kpi = (over = {}) =>
    inA((tx) =>
      kpis.createKpi(tx, {
        companyId: companyA,
        name: over.name ?? "Monthly Revenue",
        category: over.category ?? "financial",
        source: over.source ?? "manual",
        unit: over.unit ?? "currency",
        periodicity: over.periodicity ?? "monthly",
        target: over.target ?? 1000000,
        targetDirection: over.targetDirection ?? "higher_is_better",
        actorName: "Seed",
        ...over,
      }),
    );

  /** A POSTED entry, which is the only kind any formula counts. */
  const post = (input) =>
    inA((tx) =>
      journal.createJournalEntry(tx, {
        companyId: companyA,
        entryType: "sale",
        description: "test",
        postImmediately: true,
        ...input,
      }),
    );

  const revenue = (amount, date = on(15)) =>
    post({
      entryDate: date,
      lines: [
        { accountId: arAcct, debit: `${amount}.0000` },
        { accountId: salesAcct, credit: `${amount}.0000` },
      ],
    });

  const expense = (accountId, amount, date = on(15)) =>
    post({
      entryDate: date,
      entryType: "expense",
      lines: [
        { accountId, debit: `${amount}.0000` },
        { accountId: bankAcct, credit: `${amount}.0000` },
      ],
    });

  const compute = (source, periodicity = "monthly", year = Y, month = M) =>
    inA((tx) => kpis.computeKpiActual(tx, source, periodicity, year, month));

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
    customer = randomUUID();
    [cashAcct, bankAcct, arAcct, salesAcct, cogsAcct, materialsAcct, rentAcct] =
      Array.from({ length: 7 }, () => randomUUID());

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}, ${companyA}, 'customer', true, 'Kerra')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name,
                              account_type, sub_type, system_account)
        VALUES
          (${cashAcct},      ${companyA}, '1111', 'Petty Cash',       'asset',   'cash',        'petty_cash'),
          (${bankAcct},      ${companyA}, '1112', 'Equity Bank',      'asset',   'bank',        'cash_at_bank'),
          (${arAcct},        ${companyA}, '1120', 'Trade Debtors',    'asset',   'receivable',  'accounts_receivable'),
          (${salesAcct},     ${companyA}, '4000', 'Sales',            'revenue', 'sales',       NULL),
          (${cogsAcct},      ${companyA}, '5100', 'Cost of Sales',    'expense', 'cogs',        'cogs'),
          (${materialsAcct}, ${companyA}, '5410', 'Project Materials','expense', 'direct_cost', 'project_materials'),
          (${rentAcct},      ${companyA}, '6300', 'Rent',             'expense', 'occupancy',   NULL)`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the formulas read the store that now holds the data", () => {
    it("computes revenue from POSTED journal entries in the period", async () => {
      // The headline defect: this aggregated a Mongo collection nothing writes
      // any more, so it returned 0 for every company, every month.
      await revenue(400000, on(3));
      await revenue(250000, on(28));
      await revenue(999999, on(15, 2)); // February — outside the window
      expect(await compute("monthly_revenue")).toBe(650000);
    });

    it("nets a credit note off revenue, because it reads the ledger", async () => {
      await revenue(400000);
      await post({
        entryDate: on(20),
        entryType: "credit_note",
        lines: [
          { accountId: salesAcct, debit: "50000.0000" },
          { accountId: arAcct, credit: "50000.0000" },
        ],
      });
      expect(await compute("monthly_revenue")).toBe(350000);
    });

    it("ignores an entry that was never posted", async () => {
      await post({
        entryDate: on(10),
        postImmediately: false,
        lines: [
          { accountId: arAcct, debit: "800000.0000" },
          { accountId: salesAcct, credit: "800000.0000" },
        ],
      });
      expect(await compute("monthly_revenue")).toBe(0);
    });

    it("counts the whole quarter for a quarterly KPI", async () => {
      await revenue(100000, on(15, 1));
      await revenue(200000, on(15, 2));
      await revenue(300000, on(15, 3));
      await revenue(400000, on(15, 4)); // Q2
      // Month 3 is the end of Q1, which is where a quarterly figure is filed.
      expect(await compute("monthly_revenue", "quarterly", Y, 3)).toBe(600000);
    });

    it("counts the whole year for a yearly KPI", async () => {
      await revenue(100000, on(15, 1));
      await revenue(300000, on(15, 12));
      await revenue(500000, on(15, 6, Y - 1));
      expect(await compute("monthly_revenue", "yearly", Y, 12)).toBe(400000);
    });

    it("does not let the last day of the period leak into the next one", async () => {
      // The Mongo formulas built LOCAL JS Dates for the bounds and compared
      // them against a UTC timestamp, so in Nairobi (+03) the first three
      // hours of the 1st belonged to the previous month. These are `date`
      // columns compared against date literals, so there is no such seam.
      await revenue(111111, on(31));
      await revenue(222222, on(1, 4));
      expect(await compute("monthly_revenue")).toBe(111111);
    });

    it("computes AR days outstanding from the control account and the period revenue", async () => {
      await revenue(310000, on(10)); // AR 310,000 and revenue 310,000 in March
      // DSO = AR × days ÷ revenue = 310000 × 31 ÷ 310000 = 31
      expect(await compute("ar_days_outstanding")).toBeCloseTo(31, 6);
    });

    it("reports zero DSO when nothing was sold — not a division by zero", async () => {
      expect(await compute("ar_days_outstanding")).toBe(0);
    });

    it("computes average order value over invoices that left the building", async () => {
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO invoices (company_id, invoice_number, invoice_date, customer_id, status, total)
          VALUES (${companyA}, 'INV-1', ${on(2)}::date, ${customer}::uuid, 'sent',      '100000'),
                 (${companyA}, 'INV-2', ${on(9)}::date, ${customer}::uuid, 'completed', '200000'),
                 (${companyA}, 'INV-3', ${on(9)}::date, ${customer}::uuid, 'draft',     '900000'),
                 (${companyA}, 'INV-4', ${on(9)}::date, ${customer}::uuid, 'cancelled', '900000'),
                 (${companyA}, 'INV-5', ${on(9, 2)}::date, ${customer}::uuid, 'sent',   '900000')`),
      );
      // Two count: 300,000 over 2.
      expect(await compute("avg_order_value")).toBe(150000);
    });

    it("reports zero AOV rather than NaN when there were no invoices", async () => {
      expect(await compute("avg_order_value")).toBe(0);
    });

    it("counts active and probation staff as the headcount", async () => {
      await inA(async (tx) => {
        for (const [n, status] of [
          ["E1", "active"],
          ["E2", "probation"],
          ["E3", "terminated"],
          ["E4", "on_leave"],
        ]) {
          const partyId = randomUUID();
          await tx.execute(sql`
            INSERT INTO parties (id, company_id, primary_type, is_employee, name)
            VALUES (${partyId}, ${companyA}, 'employee', true, ${"Staff " + n})`);
          await tx.execute(sql`
            INSERT INTO employees (company_id, party_id, employee_number,
                                   first_name, last_name, hire_date, status,
                                   termination_date)
            VALUES (${companyA}, ${partyId}::uuid, ${n}, 'Staff', ${n},
                    '2020-01-01'::date, ${status},
                    ${status === "terminated" ? "2025-12-31" : null})`);
        }
      });
      expect(await compute("active_headcount")).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("gross margin counts direct costs, which Mongo did not", () => {
    it("subtracts BOTH cost of sales and direct costs", async () => {
      // DEVIATION. Mongo matched `systemAccount IN ('cogs','cost_of_sales')`,
      // which is account 5100 alone. Project materials, subcontractors and
      // site expenses live at 5410-5490 under sub_type 'direct_cost' — for a
      // contractor that IS the cost of sales, and excluding it made gross
      // margin ≈ 100% on a job that lost money.
      await revenue(1000000);
      await expense(cogsAcct, 200000);
      await expense(materialsAcct, 500000);
      // (1,000,000 − 700,000) / 1,000,000 = 30%
      expect(await compute("gross_margin_percent")).toBeCloseTo(30, 6);
    });

    it("leaves overheads out of it — that is what the opex ratio is for", async () => {
      await revenue(1000000);
      await expense(cogsAcct, 200000);
      await expense(rentAcct, 300000);
      expect(await compute("gross_margin_percent")).toBeCloseTo(80, 6);
    });

    it("counts every expense that is NOT cost of sales as opex", async () => {
      await revenue(1000000);
      await expense(cogsAcct, 200000);
      await expense(materialsAcct, 300000);
      await expense(rentAcct, 250000);
      expect(await compute("opex_ratio")).toBeCloseTo(25, 6);
    });

    it("never counts one shilling as both — the two ratios are complementary", async () => {
      // One predicate defines cost of sales for both formulas, so gross
      // margin and the opex ratio partition the expenses rather than
      // overlapping. Mongo's did overlap: direct costs were opex AND were not
      // subtracted from margin.
      await revenue(1000000);
      await expense(cogsAcct, 100000);
      await expense(materialsAcct, 200000);
      await expense(rentAcct, 400000);

      const margin = await compute("gross_margin_percent");
      const opex = await compute("opex_ratio");
      // 70% margin, 40% opex → 30% net, and 300k + 400k = the 700k spent.
      expect(margin).toBeCloseTo(70, 6);
      expect(opex).toBeCloseTo(40, 6);
      expect(margin - opex).toBeCloseTo(30, 6);
    });

    it("reports zero rather than dividing by a revenue of nothing", async () => {
      await expense(rentAcct, 50000);
      expect(await compute("gross_margin_percent")).toBe(0);
      expect(await compute("opex_ratio")).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("payroll is costed to the month it was earned in", () => {
    const run = (over = {}) =>
      inA((tx) =>
        tx.execute(sql`
          INSERT INTO payroll_runs (company_id, payroll_number, period_month,
            period_year, period_from, period_to, status, total_gross,
            total_employer_nssf, total_employer_ahl, paid_at, void_reason)
          VALUES (${companyA}, ${over.number ?? "PR-" + randomUUID().slice(0, 8)},
                  ${over.month ?? M}, ${over.year ?? Y},
                  ${on(1, over.month ?? M, over.year ?? Y)}::date,
                  ${on(28, over.month ?? M, over.year ?? Y)}::date,
                  ${over.status ?? "paid"},
                  ${String(over.gross ?? 500000)}::numeric,
                  ${String(over.nssf ?? 20000)}::numeric,
                  ${String(over.ahl ?? 7500)}::numeric,
                  ${over.paidAt ?? null}, ${over.voidReason ?? null})`),
      );

    it("sums gross plus the employer's own contributions", async () => {
      await run({});
      expect(await compute("monthly_payroll_cost")).toBe(527500);
    });

    it("counts an APPROVED run that has not been paid yet", async () => {
      // Mongo's filter said `status IN ('paid','approved','posted')` AND
      // `paidAt` inside the window. `paid_at` is only stamped on payment, so
      // an approved run's null fell out of the range test regardless — the
      // 'approved' in that list never selected anything, and 'posted' is not
      // a status a run can reach at all (0048 dropped it).
      await run({ status: "approved", paidAt: null });
      expect(await compute("monthly_payroll_cost")).toBe(527500);
    });

    it("ignores a draft and a voided run", async () => {
      await run({ status: "draft" });
      await run({ status: "voided", number: "PR-VOID", voidReason: "duplicate" });
      expect(await compute("monthly_payroll_cost")).toBe(0);
    });

    it("costs March's payroll to March even when it is paid in April", async () => {
      // DEVIATION, and the reason for it: matching on the payment date makes
      // a late-paying company show one month with no payroll followed by one
      // with two, and puts this on a different basis from `monthly_revenue`,
      // which reads posted entries. `payroll_to_revenue_ratio` divides one by
      // the other, so a mismatch there is a ratio of two different months.
      await run({ month: M, paidAt: `${on(4, M + 1)}T09:00:00Z` });
      expect(await compute("monthly_payroll_cost")).toBe(527500);
      expect(await compute("monthly_payroll_cost", "monthly", Y, M + 1)).toBe(0);
    });

    it("sums three months for a quarterly KPI, and rolls the year", async () => {
      await run({ month: 1, gross: 100000, nssf: 0, ahl: 0 });
      await run({ month: 2, gross: 200000, nssf: 0, ahl: 0 });
      await run({ month: 3, gross: 300000, nssf: 0, ahl: 0 });
      await run({ month: 12, year: Y - 1, gross: 900000, nssf: 0, ahl: 0 });
      expect(await compute("monthly_payroll_cost", "quarterly", Y, 3)).toBe(600000);
    });

    it("divides payroll by revenue on the same accrual basis", async () => {
      await revenue(2000000);
      await run({ gross: 500000, nssf: 0, ahl: 0 });
      expect(await compute("payroll_to_revenue_ratio")).toBeCloseTo(25, 6);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("cash position sees every bank account, not just the seeded one", () => {
    it("sums cash, bank and M-Pesa by their sub-type", async () => {
      await expense(rentAcct, 300000); // credits the bank
      await post({
        entryDate: on(5),
        entryType: "payment_received",
        lines: [
          { accountId: bankAcct, debit: "1000000.0000" },
          { accountId: arAcct, credit: "1000000.0000" },
        ],
      });
      await post({
        entryDate: on(6),
        entryType: "payment_received",
        lines: [
          { accountId: cashAcct, debit: "50000.0000" },
          { accountId: arAcct, credit: "50000.0000" },
        ],
      });
      // 1,000,000 − 300,000 + 50,000
      expect(await compute("cash_position")).toBe(750000);
    });

    it("sees a SECOND bank account, which the system_account match could not", async () => {
      // DEVIATION. `system_account` is unique per company, so the second bank
      // a business opens can never carry one — and Mongo matched on that
      // list. Half the company's cash was invisible to this tile.
      const secondBank = randomUUID();
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name,
                                account_type, sub_type, system_account)
          VALUES (${secondBank}, ${companyA}, '1113', 'KCB', 'asset', 'bank', NULL)`),
      );
      await post({
        entryDate: on(5),
        entryType: "payment_received",
        lines: [
          { accountId: secondBank, debit: "400000.0000" },
          { accountId: arAcct, credit: "400000.0000" },
        ],
      });
      expect(await compute("cash_position")).toBe(400000);
    });

    it("is a balance as of the period end, not a movement within it", async () => {
      await post({
        entryDate: on(20, 1),
        entryType: "payment_received",
        lines: [
          { accountId: bankAcct, debit: "600000.0000" },
          { accountId: arAcct, credit: "600000.0000" },
        ],
      });
      // January's receipt is still in the bank at the end of March.
      expect(await compute("cash_position")).toBe(600000);
      // …and not yet, at the end of the previous year.
      expect(await compute("cash_position", "yearly", Y - 1, 12)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the period shape is the database's rule now", () => {
    it("files a quarterly actual on the quarter's last month", async () => {
      const k = await kpi({ periodicity: "quarterly" });
      const s = await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, {
          periodYear: Y,
          periodMonth: 5, // mid-Q2
          actualValue: 123,
        }),
      );
      expect(s.periodMonth).toBe(6);
    });

    it("files a yearly actual on December", async () => {
      const k = await kpi({ periodicity: "yearly" });
      const s = await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, {
          periodYear: Y,
          periodMonth: 4,
          actualValue: 123,
        }),
      );
      expect(s.periodMonth).toBe(12);
    });

    it("REFUSES a quarterly row filed on a month that is not a quarter end", async () => {
      // The rule normalisePeriod() was the only thing enforcing. Without it a
      // quarterly snapshot on month 5 and another on month 6 are two rows for
      // one quarter, and the unique index accepts both.
      const k = await kpi({ periodicity: "quarterly" });
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO kpi_snapshots (company_id, kpi_id, periodicity,
                period_year, period_month, period_quarter, actual_value,
                target_at_time, source)
              VALUES (${companyA}, ${k.id}::uuid, 'quarterly', ${Y}, 5, 2,
                      '1', '1', 'manual')`),
          ),
        /does not fit the KPI's periodicity/i,
      );
    });

    it("REFUSES a monthly row carrying a quarter", async () => {
      const k = await kpi({});
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              INSERT INTO kpi_snapshots (company_id, kpi_id, periodicity,
                period_year, period_month, period_quarter, actual_value,
                target_at_time, source)
              VALUES (${companyA}, ${k.id}::uuid, 'monthly', ${Y}, 5, 2,
                      '1', '1', 'manual')`),
          ),
        /does not fit the KPI's periodicity/i,
      );
    });

    it("corrects a period rather than recording it twice", async () => {
      const k = await kpi({});
      await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: M, actualValue: 100 }),
      );
      await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: M, actualValue: 250 }),
      );
      const read = await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id));
      expect(read.snapshots).toHaveLength(1);
      expect(read.snapshots[0].actualValue).toBe(250);
    });

    it("keeps the note when a recompute overwrites the number", async () => {
      const k = await kpi({ source: "monthly_revenue" });
      await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, {
          periodYear: Y,
          periodMonth: M,
          actualValue: 1,
          notes: "estimated pending the bank statement",
        }),
      );
      await revenue(650000);
      await inA((tx) => kpis.computeAndRecordSnapshot(tx, k.id, Y, M, actor));

      const read = await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id));
      expect(read.snapshots[0].actualValue).toBe(650000);
      expect(read.snapshots[0].source).toBe("auto");
      expect(read.snapshots[0].notes).toBe("estimated pending the bank statement");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the target a snapshot was judged against is frozen", () => {
    it("keeps the old target on history when the target moves", async () => {
      const k = await kpi({ target: 1000000 });
      await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: 1, actualValue: 900000 }),
      );
      await inA((tx) => kpis.setKpiTarget(tx, k.id, 2000000, actor));
      await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: 2, actualValue: 900000 }),
      );

      const read = await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id));
      const byMonth = Object.fromEntries(
        read.snapshots.map((s) => [s.periodMonth, s.targetAtTime]),
      );
      expect(byMonth[1]).toBe(1000000);
      expect(byMonth[2]).toBe(2000000);
      expect(read.target).toBe(2000000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("thresholds have to agree with the direction", () => {
    it("accepts a stricter on-target band for higher-is-better", async () => {
      const k = await kpi({
        targetDirection: "higher_is_better",
        onTargetThreshold: 0.95,
        nearTargetThreshold: 0.8,
      });
      const read = await inA((tx) => kpis.getKpi(tx, k.id));
      expect(read.customThresholds).toEqual({
        onTargetThreshold: 0.95,
        nearTargetThreshold: 0.8,
      });
    });

    it("REFUSES bands the wrong way round for higher-is-better", async () => {
      // `parseKpiFormData` was the only thing checking. The seeder,
      // `updateKpiTarget` and any later writer could produce a KPI whose "at
      // risk" band was harder to reach than its "on track" one.
      await failsWith(
        () =>
          kpi({
            targetDirection: "higher_is_better",
            onTargetThreshold: 0.8,
            nearTargetThreshold: 0.95,
          }),
        /on-track band has to be harder to reach/i,
      );
    });

    it("REFUSES bands the wrong way round for lower-is-better", async () => {
      await failsWith(
        () =>
          kpi({
            targetDirection: "lower_is_better",
            onTargetThreshold: 1.2,
            nearTargetThreshold: 1.0,
          }),
        /on-track band has to be harder to reach/i,
      );
    });

    it("allows one band overridden and the other left at the default", async () => {
      const k = await kpi({ onTargetThreshold: 0.9, nearTargetThreshold: null });
      const read = await inA((tx) => kpis.getKpi(tx, k.id));
      expect(read.customThresholds.onTargetThreshold).toBe(0.9);
      expect(read.customThresholds.nearTargetThreshold).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the seeder cannot produce two of the same KPI", () => {
    const templates = [
      {
        name: "Monthly Revenue",
        category: "financial",
        source: "monthly_revenue",
        unit: "currency",
        periodicity: "monthly",
        target: 1000000,
        targetDirection: "higher_is_better",
      },
      {
        name: "Cash Position",
        category: "financial",
        source: "cash_position",
        unit: "currency",
        periodicity: "monthly",
        target: 500000,
        targetDirection: "higher_is_better",
      },
    ];

    it("creates what is missing and reports what was already there", async () => {
      const first = await inA((tx) =>
        kpis.seedKpisFromTemplates(tx, companyA, templates, actor),
      );
      expect(first.created).toHaveLength(2);
      expect(first.skipped).toHaveLength(0);

      const second = await inA((tx) =>
        kpis.seedKpisFromTemplates(tx, companyA, templates, actor),
      );
      expect(second.created).toHaveLength(0);
      expect(second.skipped).toEqual(["Monthly Revenue", "Cash Position"]);
    });

    it("treats a differently-cased or padded name as the same KPI", async () => {
      await kpi({ name: "  monthly REVENUE " });
      const seeded = await inA((tx) =>
        kpis.seedKpisFromTemplates(tx, companyA, templates, actor),
      );
      expect(seeded.skipped).toEqual(["Monthly Revenue"]);
      expect(seeded.created.map((c) => c.name)).toEqual(["Cash Position"]);
    });

    it("refuses a second KPI with an existing name, whoever writes it", async () => {
      await kpi({ name: "Gross Margin" });
      await failsWith(() => kpi({ name: "gross margin" }), /already exists/i);
    });

    it("lets another company have a KPI of the same name", async () => {
      await kpi({ name: "Monthly Revenue" });
      const other = await asTenant(companyB, (tx) =>
        kpis.createKpi(tx, {
          companyId: companyB,
          name: "Monthly Revenue",
          category: "financial",
          target: 1,
        }),
      );
      expect(other.id).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the owner is an employee again", () => {
    let employeeId;

    beforeEach(async () => {
      const partyId = randomUUID();
      employeeId = randomUUID();
      await inA(async (tx) => {
        await tx.execute(sql`
          INSERT INTO parties (id, company_id, primary_type, is_employee, name)
          VALUES (${partyId}, ${companyA}, 'employee', true, 'Wanjiku Mwangi')`);
        await tx.execute(sql`
          INSERT INTO employees (id, company_id, party_id, employee_number,
                                 first_name, last_name, hire_date, status)
          VALUES (${employeeId}, ${companyA}, ${partyId}::uuid, 'EMP-001',
                  'Wanjiku', 'Mwangi', '2021-06-01'::date, 'active')`);
      });
    });

    it("resolves the CURRENT name through the foreign key", async () => {
      // Mongo could only store the name, so a rename left every KPI that
      // person owned displaying the old one for ever.
      const k = await kpi({
        ownerEmployeeId: employeeId,
        ownerName: "Wanjiku Mwangi",
        ownerEmployeeNumber: "EMP-001",
      });
      await inA((tx) =>
        tx.execute(sql`UPDATE employees SET last_name = 'Kamau' WHERE id = ${employeeId}::uuid`),
      );

      const read = await inA((tx) => kpis.getKpi(tx, k.id));
      expect(read.owner.name).toBe("Wanjiku Kamau");
      expect(read.owner.employeeId).toBe(employeeId);
    });

    it("still accepts a free-typed owner with no employee behind it", async () => {
      const k = await kpi({ name: "Depot Uptime", ownerName: "Nairobi Depot" });
      const read = await inA((tx) => kpis.getKpi(tx, k.id));
      expect(read.owner).toEqual({
        employeeId: null,
        name: "Nairobi Depot",
        employeeNumber: null,
      });
    });

    it("keeps the KPI when the employee record goes, falling back to the name", async () => {
      const k = await kpi({
        ownerEmployeeId: employeeId,
        ownerName: "Wanjiku Mwangi",
        ownerEmployeeNumber: "EMP-001",
      });
      await admin`DELETE FROM employees WHERE id = ${employeeId}`;

      const read = await inA((tx) => kpis.getKpi(tx, k.id));
      expect(read.name).toBe("Monthly Revenue");
      expect(read.owner.employeeId).toBeNull();
      expect(read.owner.name).toBe("Wanjiku Mwangi");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the board", () => {
    it("gives every KPI its own series rather than a shared budget", async () => {
      // Mongo capped the snapshot read at seriesLength × kpiCount globally,
      // sorted by kpiId — so a KPI with three years of history could eat the
      // budget before the sort reached the last one. The window function cuts
      // per KPI.
      const busy = await kpi({ name: "Busy" });
      const quiet = await kpi({ name: "Quiet" });
      await inA(async (tx) => {
        for (let m = 1; m <= 12; m++) {
          await kpis.recordSnapshot(tx, busy.id, {
            periodYear: Y,
            periodMonth: m,
            actualValue: m * 1000,
          });
        }
        await kpis.recordSnapshot(tx, quiet.id, {
          periodYear: Y,
          periodMonth: 2,
          actualValue: 42,
        });
      });

      const board = await inA((tx) => kpis.listKpis(tx, { seriesLength: 6 }));
      const byName = Object.fromEntries(board.map((k) => [k.name, k]));
      expect(byName.Busy.series).toHaveLength(6);
      expect(byName.Quiet.series).toHaveLength(1);
      expect(byName.Quiet.latestSnapshot.actualValue).toBe(42);
    });

    it("returns the series oldest-first and the delta against the prior period", async () => {
      const k = await kpi({});
      await inA(async (tx) => {
        await kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: 1, actualValue: 200 });
        await kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: 2, actualValue: 250 });
      });

      const [row] = await inA((tx) => kpis.listKpis(tx));
      expect(row.series.map((s) => s.periodMonth)).toEqual([1, 2]);
      expect(row.latestSnapshot.periodMonth).toBe(2);
      expect(row.priorDeltaPct).toBeCloseTo(25, 6);
    });

    it("hides a deactivated KPI unless asked for it", async () => {
      const k = await kpi({});
      await inA((tx) => kpis.setKpiActive(tx, k.id, false, actor));
      expect(await inA((tx) => kpis.listKpis(tx))).toHaveLength(0);
      expect(
        await inA((tx) => kpis.listKpis(tx, { includeInactive: true })),
      ).toHaveLength(1);
    });

    it("computes the year-on-year delta on the detail read", async () => {
      const k = await kpi({});
      await inA(async (tx) => {
        await kpis.recordSnapshot(tx, k.id, {
          periodYear: Y - 1,
          periodMonth: 3,
          actualValue: 400,
        });
        await kpis.recordSnapshot(tx, k.id, {
          periodYear: Y,
          periodMonth: 2,
          actualValue: 450,
        });
        await kpis.recordSnapshot(tx, k.id, {
          periodYear: Y,
          periodMonth: 3,
          actualValue: 500,
        });
      });

      const read = await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id));
      const march = read.snapshots.find(
        (s) => s.periodYear === Y && s.periodMonth === 3,
      );
      expect(march.yoyDeltaPct).toBeCloseTo(25, 6); // 400 → 500
      expect(march.priorDeltaPct).toBeCloseTo(11.111111, 4); // 450 → 500
    });

    it("does not leak another company's KPIs", async () => {
      await kpi({ name: "Ours" });
      await asTenant(companyB, (tx) =>
        kpis.createKpi(tx, {
          companyId: companyB,
          name: "Theirs",
          category: "financial",
          target: 1,
        }),
      );
      const ours = await inA((tx) => kpis.listKpis(tx));
      expect(ours.map((k) => k.name)).toEqual(["Ours"]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("compute and store", () => {
    it("refuses to auto-compute a manual KPI", async () => {
      const k = await kpi({ source: "manual" });
      await failsWith(
        () => inA((tx) => kpis.computeAndRecordSnapshot(tx, k.id, Y, M, actor)),
        /manual-entry/i,
      );
    });

    it("stores the computed number against the KPI's own periodicity", async () => {
      await revenue(300000, on(15, 1));
      await revenue(200000, on(15, 3));
      const k = await kpi({ source: "monthly_revenue", periodicity: "quarterly" });

      // Month 1 is inside Q1; the snapshot is filed on month 3.
      const s = await inA((tx) => kpis.computeAndRecordSnapshot(tx, k.id, Y, 1, actor));
      expect(s.periodMonth).toBe(3);
      expect(s.actualValue).toBe(500000);

      const read = await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id));
      expect(read.snapshots[0].source).toBe("auto");
      expect(read.snapshots[0].periodQuarter).toBe(1);
    });

    it("treats a KPI id that cannot exist as not found, not as a crash", async () => {
      // A stale link holding a 24-character Mongo ObjectId reaches a uuid
      // column and Postgres raises 22P02 with the whole statement in it.
      expect(await inA((tx) => kpis.getKpi(tx, "6a3ba4ae0f569c9f3d9a907f"))).toBeNull();
      expect(
        await inA((tx) => kpis.getKpiWithSnapshots(tx, "6a3ba4ae0f569c9f3d9a907f")),
      ).toBeNull();
    });

    it("deletes a snapshot and says which KPI to go back to", async () => {
      const k = await kpi({});
      await inA((tx) =>
        kpis.recordSnapshot(tx, k.id, { periodYear: Y, periodMonth: M, actualValue: 5 }),
      );
      const read = await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id));
      const { kpiId } = await inA((tx) =>
        kpis.deleteSnapshot(tx, read.snapshots[0]._id),
      );
      expect(kpiId).toBe(k.id);
      expect(
        (await inA((tx) => kpis.getKpiWithSnapshots(tx, k.id))).snapshots,
      ).toHaveLength(0);
    });
  });
});
