import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  payrollConfigs,
  payeBrackets,
  payrollRuns,
  payrollEntries,
  payrollEntryLines,
  payrollRunJournals,
} from "../schema";
import { createJournalEntry, reverseJournalEntry } from "./journal";
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateAHL,
} from "@/lib/payroll/kenya-tax";

/**
 * Payroll.
 *
 * Run totals are written by `recalc_payroll_run()`; an entry's gross,
 * deductions and net are generated columns. Nothing here adds any of them up,
 * which is what stops a journal disagreeing with the payslips it was built
 * from (0048).
 *
 * The statutory maths still lives in lib/payroll/kenya-tax.js, unchanged and
 * unit-tested. Only where the rates come FROM has moved.
 */

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
};

const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const periodLabel = (month: number, year: number) =>
  `${MONTHS[month] ?? month} ${year}`;

// ── Configuration ────────────────────────────────────────────────────────────

export interface PayrollRates {
  id: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  currency: string;
  personalRelief: number;
  insuranceReliefRate: number;
  insuranceReliefCap: number;
  nssfTierILimit: number;
  nssfTierIILimit: number;
  nssfEmployeeRate: number;
  nssfEmployerRate: number;
  shifRate: number;
  shifMinimum: number;
  ahlEmployeeRate: number;
  ahlEmployerRate: number;
  payeBrackets: Array<{ from: number; to: number | null; rate: number }>;
  glMapping: Record<string, string | null>;
}

const GL_FIELDS = [
  ["salaryExpense", "salary_expense_account_id"],
  ["employerNssfExpense", "employer_nssf_expense_account_id"],
  ["employerAhlExpense", "employer_ahl_expense_account_id"],
  ["salaryPayable", "salary_payable_account_id"],
  ["payePayable", "paye_payable_account_id"],
  ["nssfPayable", "nssf_payable_account_id"],
  ["shifPayable", "shif_payable_account_id"],
  ["ahlPayable", "ahl_payable_account_id"],
  ["bankAccount", "bank_account_id"],
  ["staffLoansReceivable", "staff_loans_receivable_account_id"],
  ["interestIncome", "interest_income_account_id"],
] as const;

function mapRates(
  r: Record<string, unknown>,
  brackets: Array<Record<string, unknown>>,
): PayrollRates {
  const glMapping: Record<string, string | null> = {};
  for (const [key, column] of GL_FIELDS) {
    glMapping[key] = (r[column] as string) ?? null;
  }
  return {
    id: String(r.id),
    name: String(r.name),
    effectiveFrom: String(r.effective_from),
    effectiveTo: r.effective_to ? String(r.effective_to) : null,
    currency: String(r.currency),
    personalRelief: Number(r.personal_relief),
    insuranceReliefRate: Number(r.insurance_relief_rate),
    insuranceReliefCap: Number(r.insurance_relief_cap),
    nssfTierILimit: Number(r.nssf_tier_i_limit),
    nssfTierIILimit: Number(r.nssf_tier_ii_limit),
    nssfEmployeeRate: Number(r.nssf_employee_rate),
    nssfEmployerRate: Number(r.nssf_employer_rate),
    shifRate: Number(r.shif_rate),
    shifMinimum: Number(r.shif_minimum),
    ahlEmployeeRate: Number(r.ahl_employee_rate),
    ahlEmployerRate: Number(r.ahl_employer_rate),
    payeBrackets: brackets.map((b) => ({
      from: Number(b.from_amount),
      to: b.to_amount === null ? null : Number(b.to_amount),
      rate: Number(b.rate),
    })),
    glMapping,
  };
}

async function loadBrackets(tx: Tx, configId: string) {
  return (await tx.execute(sql`
    SELECT from_amount, to_amount, rate FROM paye_brackets
     WHERE payroll_config_id = ${configId}::uuid
     ORDER BY from_amount
  `)) as unknown as Array<Record<string, unknown>>;
}

/**
 * The rates in force for a period.
 *
 * Ranges cannot overlap (0048), so "the config covering this month" is a
 * single answer rather than the first row of a sort.
 */
export async function getRatesForPeriod(
  tx: Tx,
  year: number,
  month: number,
): Promise<PayrollRates | null> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const [row] = (await tx.execute(sql`
    SELECT * FROM payroll_configs
     WHERE effective_from <= ${periodStart}::date
       AND (effective_to IS NULL OR effective_to >= ${periodStart}::date)
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (!row) return null;
  return mapRates(row, await loadBrackets(tx, String(row.id)));
}

export async function getRatesById(tx: Tx, id: string) {
  const [row] = (await tx.execute(sql`
    SELECT * FROM payroll_configs WHERE id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) return null;
  return mapRates(row, await loadBrackets(tx, id));
}

export async function listRateConfigs(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT c.*, (SELECT COUNT(*)::int FROM paye_brackets b
                  WHERE b.payroll_config_id = c.id) AS bracket_count
      FROM payroll_configs c
     ORDER BY c.effective_from DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    effectiveFrom: String(r.effective_from),
    effectiveTo: r.effective_to ? String(r.effective_to) : null,
    currency: String(r.currency),
    bracketCount: Number(r.bracket_count),
    personalRelief: Number(r.personal_relief),
    shifRate: Number(r.shif_rate),
    ahlEmployeeRate: Number(r.ahl_employee_rate),
    /** Whether every account carrying money in the journal is mapped. */
    glMapped: GL_FIELDS.filter(([, col]) => r[col]).length,
    glTotal: GL_FIELDS.length,
  }));
}

export interface SaveRatesInput {
  companyId: string;
  id?: string;
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  personalRelief: number;
  insuranceReliefRate?: number;
  insuranceReliefCap?: number;
  nssfTierILimit: number;
  nssfTierIILimit: number;
  nssfEmployeeRate: number;
  nssfEmployerRate: number;
  shifRate: number;
  shifMinimum?: number;
  ahlEmployeeRate: number;
  ahlEmployerRate: number;
  brackets: Array<{ from: number; to: number | null; rate: number }>;
  notes?: string | null;
  actor?: { id?: string | null; name?: string | null };
}

/**
 * Creates a set of rates with its PAYE bands.
 *
 * The bands are checked for coverage once they are all in — overlap is
 * refused by an exclusion constraint, and a GAP is checked here, because a set
 * of bands is only complete when the last one has been written.
 */
export async function saveRates(tx: Tx, input: SaveRatesInput) {
  if (!input.brackets?.length) {
    throw new Error("At least one PAYE band is required.");
  }

  const values = {
    companyId: input.companyId,
    name: input.name.trim(),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo || null,
    personalRelief: money(input.personalRelief),
    insuranceReliefRate: String(input.insuranceReliefRate ?? 0.15),
    insuranceReliefCap: money(input.insuranceReliefCap ?? 5000),
    nssfTierILimit: money(input.nssfTierILimit),
    nssfTierIILimit: money(input.nssfTierIILimit),
    nssfEmployeeRate: String(input.nssfEmployeeRate),
    nssfEmployerRate: String(input.nssfEmployerRate),
    shifRate: String(input.shifRate),
    shifMinimum: money(input.shifMinimum ?? 300),
    ahlEmployeeRate: String(input.ahlEmployeeRate),
    ahlEmployerRate: String(input.ahlEmployerRate),
    notes: input.notes ?? null,
    lastModifiedById: input.actor?.id ?? null,
    lastModifiedByName: input.actor?.name ?? null,
    updatedAt: new Date(),
  };

  let configId = input.id;
  if (configId) {
    const [updated] = await tx
      .update(payrollConfigs)
      .set(values)
      .where(eq(payrollConfigs.id, configId))
      .returning();
    if (!updated) throw new Error("That payroll configuration no longer exists.");
    await tx.delete(payeBrackets).where(eq(payeBrackets.payrollConfigId, configId));
  } else {
    const [created] = await tx
      .insert(payrollConfigs)
      .values({ ...values, createdById: input.actor?.id ?? null })
      .returning();
    configId = created.id;
  }

  const sorted = [...input.brackets].sort((a, b) => a.from - b.from);
  await tx.insert(payeBrackets).values(
    sorted.map((b) => ({
      companyId: input.companyId,
      payrollConfigId: configId!,
      fromAmount: money(b.from),
      toAmount: b.to == null ? null : money(b.to),
      rate: String(b.rate),
    })),
  );

  await tx.execute(sql`SELECT assert_paye_brackets_cover(${configId}::uuid)`);

  return { id: configId };
}

export async function saveGlMapping(
  tx: Tx,
  input: {
    configId: string;
    mapping: Record<string, string | null>;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const set: Record<string, unknown> = {
    lastModifiedById: input.actor?.id ?? null,
    lastModifiedByName: input.actor?.name ?? null,
    updatedAt: new Date(),
  };
  const columnFor: Record<string, string> = {};
  for (const [key, column] of GL_FIELDS) columnFor[key] = column;

  const assignments = Object.entries(input.mapping)
    .filter(([key]) => key in columnFor)
    .map(([key, value]) =>
      sql`${sql.raw(`"${columnFor[key]}"`)} = ${value || null}::uuid`,
    );

  if (!assignments.length) return { updated: 0 };

  await tx.execute(sql`
    UPDATE payroll_configs
       SET ${sql.join(assignments, sql`, `)},
           last_modified_by_id = ${input.actor?.id ?? null},
           last_modified_by_name = ${input.actor?.name ?? null},
           updated_at = now()
     WHERE id = ${input.configId}::uuid
  `);
  void set;
  return { updated: assignments.length };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export async function createRun(
  tx: Tx,
  input: {
    companyId: string;
    month: number;
    year: number;
    departmentId?: string | null;
    notes?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  if (!(input.month >= 1 && input.month <= 12)) {
    throw new Error("Month must be between 1 and 12");
  }

  const rates = await getRatesForPeriod(tx, input.year, input.month);
  if (!rates) {
    throw new Error(
      `No payroll rates cover ${periodLabel(input.month, input.year)}. Set up payroll settings first.`,
    );
  }

  const stamp = `${input.year}${String(input.month).padStart(2, "0")}`;
  const [{ number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, ${"PR-" + stamp}) AS number`,
  )) as unknown as Array<{ number: string }>;

  const from = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  const [{ last_day }] = (await tx.execute(
    sql`SELECT (date_trunc('month', ${from}::date) + interval '1 month - 1 day')::date AS last_day`,
  )) as unknown as Array<{ last_day: string }>;

  const [created] = await tx
    .insert(payrollRuns)
    .values({
      companyId: input.companyId,
      payrollNumber: number,
      periodMonth: input.month,
      periodYear: input.year,
      periodFrom: from,
      periodTo: String(last_day).slice(0, 10),
      departmentId: input.departmentId || null,
      payrollConfigId: rates.id,
      notes: input.notes ?? null,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .returning();

  return created;
}

export interface GenerateResult {
  processed: number;
  skipped: Array<{ employeeNumber: string; name: string; reason: string }>;
}

/**
 * Builds a payslip for every employee in scope.
 *
 * Idempotent: keyed on (run, employee), so re-running converges rather than
 * duplicating. One employee failing does not roll back the rest — the source
 * made that choice deliberately and it is right.
 *
 * Everything the payslip needs is read in ONE query per run, not per employee:
 * the source runs a working-days count per employee and another per unpaid
 * leave record, each of which re-reads the holiday calendar.
 */
export async function generateEntries(
  tx: Tx,
  input: {
    companyId: string;
    runId: string;
    actor?: { id?: string | null; name?: string | null };
  },
): Promise<GenerateResult> {
  const run = await getRunRow(tx, input.runId);
  if (!run) throw new Error("Payroll run not found");
  if (!["draft", "processing", "review"].includes(run.status)) {
    throw new Error(
      "Payslips can only be generated while the run is still being prepared.",
    );
  }

  const rates = run.payrollConfigId
    ? await getRatesById(tx, run.payrollConfigId)
    : await getRatesForPeriod(tx, run.periodYear, run.periodMonth);
  if (!rates) {
    throw new Error(
      "No payroll rates cover this period. Set up payroll settings before generating payslips.",
    );
  }
  if (!rates.payeBrackets.length) {
    throw new Error("The payroll configuration has no PAYE bands.");
  }

  const departmentScope = run.departmentId
    ? sql`AND e.department_id = ${run.departmentId}::uuid`
    : sql``;

  /*
   * One pass. `working_days()` is the same function leave uses, so the two
   * cannot disagree about how long the month is; unpaid leave is clipped to
   * the period in SQL rather than by a query per leave record.
   */
  const rows = (await tx.execute(sql`
    WITH period AS (
      SELECT ${run.periodFrom}::date AS from_date,
             ${run.periodTo}::date   AS to_date,
             working_days(${input.companyId}::uuid,
                          ${run.periodFrom}::date, ${run.periodTo}::date) AS total_days
    )
    SELECT e.id, e.employee_number, e.full_name, e.designation,
           e.employment_type, e.kra_pin, e.nssf_number, e.sha_number,
           e.bank_name, e.bank_branch, e.bank_account, e.mpesa_number,
           e.payment_method, e.currency,
           e.basic_salary, e.allowance_housing, e.allowance_transport,
           e.allowance_medical, e.allowance_other,
           d.name AS department,
           p.total_days,
           /* Days they were actually on the payroll this month. */
           working_days(
             ${input.companyId}::uuid,
             GREATEST(e.hire_date, p.from_date),
             LEAST(COALESCE(e.termination_date, p.to_date), p.to_date)
           ) AS employed_days,
           COALESCE(lwop.days, 0) AS unpaid_leave_days,
           COALESCE(ot.hours, 0)  AS overtime_hours
      FROM employees e
      CROSS JOIN period p
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN LATERAL (
        SELECT SUM(
                 working_days(
                   ${input.companyId}::uuid,
                   GREATEST(r.from_date, p.from_date),
                   LEAST(r.to_date, p.to_date)
                 )
               ) AS days
          FROM leave_requests r
          JOIN leave_types lt ON lt.id = r.leave_type_id
         WHERE r.employee_id = e.id
           AND r.status IN ('approved', 'completed')
           AND NOT lt.is_paid
           AND r.from_date <= p.to_date
           AND r.to_date   >= p.from_date
      ) lwop ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(a.overtime_hours) AS hours
          FROM attendance a
         WHERE a.employee_id = e.id
           AND a.work_date BETWEEN p.from_date AND p.to_date
      ) ot ON TRUE
     WHERE e.status IN ('active', 'probation', 'on_leave', 'suspended')
       AND e.hire_date <= p.to_date
       AND (e.termination_date IS NULL OR e.termination_date >= p.from_date)
       ${departmentScope}
     ORDER BY e.full_name
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) {
    throw new Error("There are no employees to pay for this period.");
  }

  // What each employee owes this month, from their loan schedule.
  const loanRows = (await tx.execute(sql`
    SELECT l.employee_id, l.loan_type, SUM(i.total) AS due
      FROM loan_installments i
      JOIN loans l ON l.id = i.loan_id
     WHERE i.status = 'pending'
       AND i.period_year = ${run.periodYear}
       AND i.period_month = ${run.periodMonth}
       AND l.status IN ('disbursed', 'active')
     GROUP BY l.employee_id, l.loan_type
  `)) as unknown as Array<{ employee_id: string; loan_type: string; due: string }>;

  const loanDue = new Map<string, { loan: number; sacco: number }>();
  for (const l of loanRows) {
    const cur = loanDue.get(l.employee_id) ?? { loan: 0, sacco: 0 };
    if (l.loan_type === "sacco_deduction") cur.sacco += Number(l.due);
    else cur.loan += Number(l.due);
    loanDue.set(l.employee_id, cur);
  }

  const skipped: GenerateResult["skipped"] = [];
  let processed = 0;

  for (const r of rows) {
    try {
      const totalDays = Number(r.total_days);
      const employedDays = Number(r.employed_days);
      const lwopDays = Number(r.unpaid_leave_days);

      // Pro-rata for a mid-month joiner or leaver, then unpaid leave on top.
      const paidDays = Math.max(0, employedDays - lwopDays);
      const fraction = totalDays > 0 ? paidDays / totalDays : 1;

      const scale = (v: unknown) => Math.round(Number(v ?? 0) * fraction);
      const basic = scale(r.basic_salary);
      const housing = scale(r.allowance_housing);
      const transport = scale(r.allowance_transport);
      const medical = scale(r.allowance_medical);
      const other = scale(r.allowance_other);

      const gross = basic + housing + transport + medical + other;

      const nssf = calculateNSSF(gross, rates);
      const shif = calculateSHIF(gross, rates);
      const ahl = calculateAHL(gross, rates);
      // NSSF, SHIF and AHL are all allowable before PAYE — Tax Laws
      // (Amendment) Act 2024.
      const taxable = Math.max(0, gross - nssf.employee - shif - ahl.employee);
      const { paye, insuranceRelief } = calculatePAYE(taxable, rates);

      const loans = loanDue.get(String(r.id)) ?? { loan: 0, sacco: 0 };

      const note =
        employedDays < totalDays || lwopDays > 0
          ? `Pro-rata: ${paidDays}/${totalDays} days` +
            (lwopDays ? `. Unpaid leave: ${lwopDays} day(s)` : "")
          : null;

      await tx.execute(sql`
        INSERT INTO payroll_entries (
          company_id, payroll_run_id, employee_id,
          employee_number, employee_name, department, designation, employment_type,
          kra_pin, nssf_number, sha_number,
          bank_name, bank_branch, bank_account, mpesa_number, payment_method,
          basic_salary, housing_allowance, transport_allowance, medical_allowance,
          other_allowance,
          paye, nssf, shif, housing_levy, insurance_relief,
          loan_repayment, sacco_deduction,
          employer_nssf, employer_housing_levy,
          currency, working_days_total, working_days_worked, unpaid_leave_days,
          notes, created_by_id, created_by_name
        ) VALUES (
          ${input.companyId}::uuid, ${input.runId}::uuid, ${String(r.id)}::uuid,
          ${String(r.employee_number)}, ${String(r.full_name)},
          ${(r.department as string) ?? null}, ${(r.designation as string) ?? null},
          ${(r.employment_type as string) ?? null},
          ${(r.kra_pin as string) ?? null}, ${(r.nssf_number as string) ?? null},
          ${(r.sha_number as string) ?? null},
          ${(r.bank_name as string) ?? null}, ${(r.bank_branch as string) ?? null},
          ${(r.bank_account as string) ?? null}, ${(r.mpesa_number as string) ?? null},
          ${String(r.payment_method ?? "bank")},
          ${money(basic)}, ${money(housing)}, ${money(transport)}, ${money(medical)},
          ${money(other)},
          ${money(paye)}, ${money(nssf.employee)}, ${money(shif)},
          ${money(ahl.employee)}, ${money(insuranceRelief)},
          ${money(loans.loan)}, ${money(loans.sacco)},
          ${money(nssf.employer)}, ${money(ahl.employer)},
          ${String(r.currency ?? "KES")}, ${totalDays}, ${paidDays},
          ${lwopDays.toFixed(2)},
          ${note}, ${input.actor?.id ?? null}, ${input.actor?.name ?? null}
        )
        ON CONFLICT (payroll_run_id, employee_id) DO UPDATE SET
          employee_number = EXCLUDED.employee_number,
          employee_name = EXCLUDED.employee_name,
          department = EXCLUDED.department,
          designation = EXCLUDED.designation,
          employment_type = EXCLUDED.employment_type,
          kra_pin = EXCLUDED.kra_pin,
          nssf_number = EXCLUDED.nssf_number,
          sha_number = EXCLUDED.sha_number,
          bank_name = EXCLUDED.bank_name,
          bank_branch = EXCLUDED.bank_branch,
          bank_account = EXCLUDED.bank_account,
          mpesa_number = EXCLUDED.mpesa_number,
          payment_method = EXCLUDED.payment_method,
          basic_salary = EXCLUDED.basic_salary,
          housing_allowance = EXCLUDED.housing_allowance,
          transport_allowance = EXCLUDED.transport_allowance,
          medical_allowance = EXCLUDED.medical_allowance,
          other_allowance = EXCLUDED.other_allowance,
          paye = EXCLUDED.paye,
          nssf = EXCLUDED.nssf,
          shif = EXCLUDED.shif,
          housing_levy = EXCLUDED.housing_levy,
          insurance_relief = EXCLUDED.insurance_relief,
          loan_repayment = EXCLUDED.loan_repayment,
          sacco_deduction = EXCLUDED.sacco_deduction,
          employer_nssf = EXCLUDED.employer_nssf,
          employer_housing_levy = EXCLUDED.employer_housing_levy,
          working_days_total = EXCLUDED.working_days_total,
          working_days_worked = EXCLUDED.working_days_worked,
          unpaid_leave_days = EXCLUDED.unpaid_leave_days,
          notes = EXCLUDED.notes,
          last_modified_by_id = ${input.actor?.id ?? null},
          last_modified_by_name = ${input.actor?.name ?? null},
          updated_at = now()
      `);
      processed++;
    } catch (err) {
      // Surfaced, never silently omitted: an employee missing from a payroll
      // run is somebody who does not get paid.
      skipped.push({
        employeeNumber: String(r.employee_number ?? "(unknown)"),
        name: String(r.full_name ?? "(unknown)"),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await tx
    .update(payrollRuns)
    .set({
      status: "processing",
      preparedAt: new Date(),
      preparedById: input.actor?.id ?? null,
      preparedByName: input.actor?.name ?? null,
      payrollConfigId: rates.id,
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, input.runId));

  return { processed, skipped };
}

async function getRunRow(tx: Tx, id: string) {
  const [r] = (await tx.execute(sql`
    SELECT * FROM payroll_runs WHERE id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!r) return null;
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    payrollNumber: String(r.payroll_number),
    periodMonth: Number(r.period_month),
    periodYear: Number(r.period_year),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    departmentId: (r.department_id as string) ?? null,
    payrollConfigId: (r.payroll_config_id as string) ?? null,
    status: String(r.status),
    totals: {
      employeeCount: Number(r.employee_count),
      gross: Number(r.total_gross),
      paye: Number(r.total_paye),
      nssf: Number(r.total_nssf),
      shif: Number(r.total_shif),
      housingLevy: Number(r.total_housing_levy),
      otherDeductions: Number(r.total_other_deductions),
      deductions: Number(r.total_deductions),
      net: Number(r.total_net),
      employerNssf: Number(r.total_employer_nssf),
      employerAhl: Number(r.total_employer_ahl),
    },
  };
}

// ── Approval, payment, void ──────────────────────────────────────────────────

/**
 * The accrual journal.
 *
 *   Dr salary expense        gross
 *   Dr employer NSSF expense employer NSSF
 *   Dr employer AHL expense  employer AHL
 *   Cr PAYE payable          PAYE
 *   Cr NSSF payable          employee + employer NSSF
 *   Cr SHIF payable          SHIF
 *   Cr AHL payable           employee + employer AHL
 *   Cr staff loans           loan and SACCO repayments
 *   Cr salaries payable      net
 *
 * EVERY ACCOUNT CARRYING AN AMOUNT MUST BE MAPPED, and the failure names the
 * ones that are not. The source builds the lines with a helper that returns
 * null for an unmapped account, filters the nulls out, and then infers "is a
 * mapping missing?" from "is the entry unbalanced?" — which is not the same
 * question. A small missing leg hides under the tolerance and posts; two
 * missing legs can CANCEL, and NSSF then appears nowhere in the books at all.
 */
function buildAccrualLines(
  rates: PayrollRates,
  totals: NonNullable<Awaited<ReturnType<typeof getRunRow>>>["totals"],
  label: string,
) {
  const gl = rates.glMapping;
  const required: Array<[string, string | null, number, "debit" | "credit", string]> = [
    ["Salary expense", gl.salaryExpense, totals.gross, "debit", `Gross pay — ${label}`],
    ["Employer NSSF expense", gl.employerNssfExpense, totals.employerNssf, "debit", `Employer NSSF — ${label}`],
    ["Employer AHL expense", gl.employerAhlExpense, totals.employerAhl, "debit", `Employer AHL — ${label}`],
    ["PAYE payable", gl.payePayable, totals.paye, "credit", `PAYE payable — ${label}`],
    ["NSSF payable", gl.nssfPayable, totals.nssf + totals.employerNssf, "credit", `NSSF payable — ${label}`],
    ["SHIF payable", gl.shifPayable, totals.shif, "credit", `SHIF payable — ${label}`],
    ["AHL payable", gl.ahlPayable, totals.housingLevy + totals.employerAhl, "credit", `AHL payable — ${label}`],
    ["Staff loans receivable", gl.staffLoansReceivable, totals.otherDeductions, "credit", `Loan and SACCO repayments — ${label}`],
    ["Salaries payable", gl.salaryPayable, totals.net, "credit", `Net salaries payable — ${label}`],
  ];

  const unmapped = required
    .filter(([, account, amount]) => amount !== 0 && !account)
    .map(([name]) => name);

  if (unmapped.length) {
    throw new Error(
      `Payroll cannot post: ${unmapped.join(", ")} ${unmapped.length === 1 ? "is" : "are"} not mapped to an account. Map ${unmapped.length === 1 ? "it" : "them"} under Settings → Payroll.`,
    );
  }

  return required
    .filter(([, account, amount]) => amount !== 0 && account)
    .map(([, account, amount, side, description]) => ({
      accountId: account as string,
      debit: side === "debit" ? money(amount) : "0",
      credit: side === "credit" ? money(amount) : "0",
      description,
    }));
}

/**
 * Approves a run and posts its accrual, IN THE SAME TRANSACTION.
 *
 * The source catches a GL failure and approves anyway with a warning, so a
 * payroll can be approved — and the loans marked repaid — with nothing in the
 * books. Here they succeed together or neither happens, which is what
 * "approved" is supposed to mean.
 *
 * Marking the loan instalments repaid is part of the same transaction for the
 * same reason.
 */
export async function approveRun(
  tx: Tx,
  input: { companyId: string; runId: string; actor: { id: string; name: string } },
) {
  const run = await getRunRow(tx, input.runId);
  if (!run) throw new Error("Payroll run not found");
  if (!["processing", "review", "draft"].includes(run.status)) {
    throw new Error("Only a run still being prepared can be approved.");
  }
  if (run.totals.employeeCount === 0) {
    throw new Error("This run has no payslips. Generate them first.");
  }

  // The identity payroll balances by. It holds exactly here because every
  // total is summed by the database from the same numeric column.
  const drift =
    run.totals.gross - (run.totals.deductions + run.totals.net);
  if (Math.abs(drift) > 0.0001) {
    throw new Error(
      `The payslips do not add up: gross ${run.totals.gross} against deductions plus net ${run.totals.deductions + run.totals.net}.`,
    );
  }

  const rates = run.payrollConfigId
    ? await getRatesById(tx, run.payrollConfigId)
    : await getRatesForPeriod(tx, run.periodYear, run.periodMonth);
  if (!rates) throw new Error("The payroll rates for this period are missing.");

  const label = periodLabel(run.periodMonth, run.periodYear);
  const lines = buildAccrualLines(rates, run.totals, label);

  // Dated the last day of the period, not today: the expense belongs to the
  // month it was earned in, and the fiscal-period trigger then enforces the
  // right period.
  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: run.periodTo,
    entryType: "payroll",
    description: `Payroll accrual — ${label} (${run.payrollNumber})`,
    reference: run.payrollNumber,
    lines,
    createdById: input.actor.id,
    postImmediately: true,
  });

  await tx.insert(payrollRunJournals).values({
    companyId: input.companyId,
    payrollRunId: run.id,
    journalEntryId: entry.id,
    kind: "accrual",
  });

  // Loan instalments for this period are now repaid, and they name the run.
  const repaid = (await tx.execute(sql`
    UPDATE loan_installments i
       SET status = 'deducted',
           payroll_run_id = ${run.id}::uuid,
           paid_at = now(),
           updated_at = now()
      FROM loans l
     WHERE l.id = i.loan_id
       AND i.status = 'pending'
       AND i.period_year = ${run.periodYear}
       AND i.period_month = ${run.periodMonth}
       AND l.status IN ('disbursed', 'active')
    RETURNING i.loan_id
  `)) as unknown as Array<{ loan_id: string }>;

  await closeFullyRepaidLoans(tx);

  const [updated] = await tx
    .update(payrollRuns)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedById: input.actor.id,
      approvedByName: input.actor.name,
      lastModifiedById: input.actor.id,
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, run.id))
    .returning();

  return { run: updated, journalEntryId: entry.id, loansRepaid: repaid.length };
}

/** A loan with nothing left pending is repaid. Derived, then recorded. */
async function closeFullyRepaidLoans(tx: Tx) {
  await tx.execute(sql`
    UPDATE loans l
       SET status = 'fully_repaid', updated_at = now()
     WHERE l.status IN ('disbursed', 'active')
       AND NOT EXISTS (
         SELECT 1 FROM loan_installments i
          WHERE i.loan_id = l.id AND i.status = 'pending'
       )
       AND EXISTS (SELECT 1 FROM loan_installments i WHERE i.loan_id = l.id)
  `);
}

/** Approved → paid, with the clearing journal. */
export async function markRunPaid(
  tx: Tx,
  input: {
    companyId: string;
    runId: string;
    paymentReference?: string | null;
    actor: { id: string; name: string };
  },
) {
  const run = await getRunRow(tx, input.runId);
  if (!run) throw new Error("Payroll run not found");
  if (run.status !== "approved") {
    throw new Error("Only an approved run can be marked as paid.");
  }

  const rates = run.payrollConfigId
    ? await getRatesById(tx, run.payrollConfigId)
    : await getRatesForPeriod(tx, run.periodYear, run.periodMonth);
  if (!rates) throw new Error("The payroll rates for this period are missing.");

  const gl = rates.glMapping;
  if (!gl.salaryPayable || !gl.bankAccount) {
    throw new Error(
      "Payroll cannot be paid: the salaries payable account or the bank account is not mapped. Map them under Settings → Payroll.",
    );
  }

  const label = periodLabel(run.periodMonth, run.periodYear);
  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "payroll",
    description: `Payroll payment — ${label} (${run.payrollNumber})`,
    reference: run.payrollNumber,
    lines: [
      {
        accountId: gl.salaryPayable,
        debit: money(run.totals.net),
        credit: "0",
        description: `Salaries payable cleared — ${label}`,
      },
      {
        accountId: gl.bankAccount,
        debit: "0",
        credit: money(run.totals.net),
        description: `Bank payment — ${label}`,
      },
    ],
    createdById: input.actor.id,
    postImmediately: true,
  });

  await tx.insert(payrollRunJournals).values({
    companyId: input.companyId,
    payrollRunId: run.id,
    journalEntryId: entry.id,
    kind: "payment",
  });

  await tx.execute(sql`
    UPDATE payroll_entries
       SET payment_status = 'paid',
           paid_at = now(),
           payment_reference = COALESCE(${input.paymentReference ?? null}, payment_reference),
           updated_at = now()
     WHERE payroll_run_id = ${run.id}::uuid
       AND payment_status <> 'paid'
  `);

  const [updated] = await tx
    .update(payrollRuns)
    .set({
      status: "paid",
      paidAt: new Date(),
      paidById: input.actor.id,
      paidByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, run.id))
    .returning();

  return { run: updated, journalEntryId: entry.id };
}

/**
 * Voids a run: reverses every journal it posted AND returns its loan
 * instalments to pending.
 *
 * The second half is the correction. voidPayrollRun reverses the journals and
 * leaves the instalments marked deducted, so the loan shows a repayment that
 * was reversed out of the books — and the next run deducts the same month
 * again.
 */
export async function voidRun(
  tx: Tx,
  input: {
    companyId: string;
    runId: string;
    reason: string;
    actor: { id: string; name: string };
  },
) {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("A void needs a reason.");

  const run = await getRunRow(tx, input.runId);
  if (!run) throw new Error("Payroll run not found");
  if (run.status === "voided") throw new Error("This run is already voided.");
  if (run.status === "paid") {
    throw new Error(
      "This payroll has been paid. Voiding it would not recover the money — raise an adjustment instead.",
    );
  }

  const journals = (await tx.execute(sql`
    SELECT j.journal_entry_id, e.status
      FROM payroll_run_journals j
      JOIN journal_entries e ON e.id = j.journal_entry_id
     WHERE j.payroll_run_id = ${run.id}::uuid
       AND j.kind <> 'reversal'
       AND e.status = 'posted'
  `)) as unknown as Array<{ journal_entry_id: string }>;

  for (const j of journals) {
    const reversal = await reverseJournalEntry(
      tx,
      j.journal_entry_id,
      input.actor.id,
      `Payroll voided: ${reason}`,
    );
    await tx.insert(payrollRunJournals).values({
      companyId: input.companyId,
      payrollRunId: run.id,
      journalEntryId: reversal.id,
      kind: "reversal",
    });
  }

  // Give the loan instalments back.
  const restored = (await tx.execute(sql`
    UPDATE loan_installments
       SET status = 'pending', payroll_run_id = NULL, paid_at = NULL,
           updated_at = now()
     WHERE payroll_run_id = ${run.id}::uuid AND status = 'deducted'
    RETURNING loan_id
  `)) as unknown as Array<{ loan_id: string }>;

  // A loan closed by this run is active again.
  await tx.execute(sql`
    UPDATE loans l
       SET status = 'active', updated_at = now()
     WHERE l.status = 'fully_repaid'
       AND EXISTS (
         SELECT 1 FROM loan_installments i
          WHERE i.loan_id = l.id AND i.status = 'pending'
       )
  `);

  const [updated] = await tx
    .update(payrollRuns)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidedById: input.actor.id,
      voidedByName: input.actor.name,
      voidReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, run.id))
    .returning();

  return {
    run: updated,
    journalsReversed: journals.length,
    installmentsRestored: restored.length,
  };
}

/** Hands a prepared run to whoever approves it. */
export async function submitRunForReview(
  tx: Tx,
  input: { runId: string; actor: { id: string; name: string } },
) {
  const run = await getRunRow(tx, input.runId);
  if (!run) throw new Error("Payroll run not found");
  if (run.status !== "processing") {
    throw new Error("Only a prepared run can be sent for review.");
  }
  if (run.totals.employeeCount === 0) {
    throw new Error("This run has no payslips. Generate them first.");
  }

  const [updated] = await tx
    .update(payrollRuns)
    .set({
      status: "review",
      reviewedAt: new Date(),
      reviewedById: input.actor.id,
      reviewedByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, run.id))
    .returning();
  return updated;
}

// ── Entries ──────────────────────────────────────────────────────────────────

export async function updateEntry(
  tx: Tx,
  input: {
    entryId: string;
    values: Record<string, number>;
    notes?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const [entry] = (await tx.execute(sql`
    SELECT e.id, r.status FROM payroll_entries e
      JOIN payroll_runs r ON r.id = e.payroll_run_id
     WHERE e.id = ${input.entryId}::uuid
  `)) as unknown as Array<{ id: string; status: string }>;

  if (!entry) throw new Error("Payslip not found");
  if (!["draft", "processing", "review"].includes(entry.status)) {
    throw new Error(
      "This payroll has been approved. Void it if the figures need changing.",
    );
  }

  const editable = [
    "basicSalary", "housingAllowance", "transportAllowance", "medicalAllowance",
    "otherAllowance", "overtimePay", "bonus", "commission",
    "paye", "nssf", "shif", "housingLevy", "insuranceRelief",
    "loanRepayment", "saccoDeduction", "employerNssf", "employerHousingLevy",
  ] as const;

  const column: Record<string, string> = {
    basicSalary: "basic_salary",
    housingAllowance: "housing_allowance",
    transportAllowance: "transport_allowance",
    medicalAllowance: "medical_allowance",
    otherAllowance: "other_allowance",
    overtimePay: "overtime_pay",
    bonus: "bonus",
    commission: "commission",
    paye: "paye",
    nssf: "nssf",
    shif: "shif",
    housingLevy: "housing_levy",
    insuranceRelief: "insurance_relief",
    loanRepayment: "loan_repayment",
    saccoDeduction: "sacco_deduction",
    employerNssf: "employer_nssf",
    employerHousingLevy: "employer_housing_levy",
  };

  const assignments = editable
    .filter((k) => input.values[k] !== undefined)
    .map((k) => sql`${sql.raw(`"${column[k]}"`)} = ${money(input.values[k])}`);

  if (input.notes !== undefined) {
    assignments.push(sql`notes = ${input.notes || null}`);
  }
  if (!assignments.length) return { updated: false };

  await tx.execute(sql`
    UPDATE payroll_entries
       SET ${sql.join(assignments, sql`, `)},
           last_modified_by_id = ${input.actor?.id ?? null},
           last_modified_by_name = ${input.actor?.name ?? null},
           updated_at = now()
     WHERE id = ${input.entryId}::uuid
  `);

  return { updated: true };
}

export async function addEntryLine(
  tx: Tx,
  input: {
    companyId: string;
    entryId: string;
    kind: "earning" | "deduction";
    description: string;
    amount: number;
    accountId?: string | null;
  },
) {
  const [created] = await tx
    .insert(payrollEntryLines)
    .values({
      companyId: input.companyId,
      payrollEntryId: input.entryId,
      kind: input.kind,
      description: input.description.trim(),
      amount: money(input.amount),
      accountId: input.accountId || null,
    })
    .returning();
  return created;
}

export async function removeEntryLine(tx: Tx, lineId: string) {
  const [deleted] = await tx
    .delete(payrollEntryLines)
    .where(eq(payrollEntryLines.id, lineId))
    .returning({ id: payrollEntryLines.id });
  if (!deleted) throw new Error("That line no longer exists.");
  return { deleted: true };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listRuns(
  tx: Tx,
  opts: { status?: string | null; year?: number | null; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const filters = [sql`TRUE`];
  if (opts.status) filters.push(sql`r.status = ${opts.status}`);
  if (opts.year) filters.push(sql`r.period_year = ${opts.year}`);

  const rows = (await tx.execute(sql`
    SELECT r.id, r.payroll_number, r.period_month, r.period_year,
           r.period_from, r.period_to, r.status, r.currency,
           r.employee_count, r.total_gross, r.total_deductions, r.total_net,
           d.name AS department,
           r.approved_at, r.paid_at, r.voided_at,
           COUNT(*) OVER () AS total
      FROM payroll_runs r
      LEFT JOIN departments d ON d.id = r.department_id
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY r.period_year DESC, r.period_month DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      payrollNumber: String(r.payroll_number),
      month: Number(r.period_month),
      year: Number(r.period_year),
      label: periodLabel(Number(r.period_month), Number(r.period_year)),
      periodFrom: String(r.period_from),
      periodTo: String(r.period_to),
      status: String(r.status),
      currency: String(r.currency),
      department: (r.department as string) ?? null,
      employeeCount: Number(r.employee_count),
      totalGross: Number(r.total_gross),
      totalDeductions: Number(r.total_deductions),
      totalNet: Number(r.total_net),
      approvedAt: r.approved_at ? new Date(r.approved_at as string).toISOString() : null,
      paidAt: r.paid_at ? new Date(r.paid_at as string).toISOString() : null,
      voidedAt: r.voided_at ? new Date(r.voided_at as string).toISOString() : null,
    })),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

export async function getRun(tx: Tx, id: string) {
  const [r] = (await tx.execute(sql`
    SELECT r.*, d.name AS department, c.name AS config_name
      FROM payroll_runs r
      LEFT JOIN departments d     ON d.id = r.department_id
      LEFT JOIN payroll_configs c ON c.id = r.payroll_config_id
     WHERE r.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!r) return null;

  const journals = (await tx.execute(sql`
    SELECT j.kind, e.entry_number, e.id, e.status, e.entry_date
      FROM payroll_run_journals j
      JOIN journal_entries e ON e.id = j.journal_entry_id
     WHERE j.payroll_run_id = ${id}::uuid
     ORDER BY j.created_at
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (k: string) => Number(r[k] ?? 0);
  return {
    id: String(r.id),
    payrollNumber: String(r.payroll_number),
    month: Number(r.period_month),
    year: Number(r.period_year),
    label: periodLabel(Number(r.period_month), Number(r.period_year)),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    status: String(r.status),
    currency: String(r.currency),
    department: (r.department as string) ?? null,
    configName: (r.config_name as string) ?? null,
    notes: (r.notes as string) ?? null,
    voidReason: (r.void_reason as string) ?? null,
    totals: {
      employeeCount: Number(r.employee_count),
      basic: n("total_basic"),
      allowances: n("total_allowances"),
      gross: n("total_gross"),
      paye: n("total_paye"),
      nssf: n("total_nssf"),
      shif: n("total_shif"),
      housingLevy: n("total_housing_levy"),
      otherDeductions: n("total_other_deductions"),
      deductions: n("total_deductions"),
      net: n("total_net"),
      employerNssf: n("total_employer_nssf"),
      employerAhl: n("total_employer_ahl"),
    },
    preparedByName: (r.prepared_by_name as string) ?? null,
    reviewedByName: (r.reviewed_by_name as string) ?? null,
    approvedByName: (r.approved_by_name as string) ?? null,
    paidByName: (r.paid_by_name as string) ?? null,
    voidedByName: (r.voided_by_name as string) ?? null,
    approvedAt: r.approved_at ? new Date(r.approved_at as string).toISOString() : null,
    paidAt: r.paid_at ? new Date(r.paid_at as string).toISOString() : null,
    voidedAt: r.voided_at ? new Date(r.voided_at as string).toISOString() : null,
    journals: journals.map((j) => ({
      id: String(j.id),
      kind: String(j.kind),
      entryNumber: String(j.entry_number),
      status: String(j.status),
      entryDate: String(j.entry_date),
    })),
  };
}

export async function listEntries(
  tx: Tx,
  runId: string,
  opts: { search?: string } = {},
) {
  const filters = [sql`e.payroll_run_id = ${runId}::uuid`];
  if (opts.search?.trim()) {
    const like = `%${opts.search.trim()}%`;
    filters.push(sql`(e.employee_name ILIKE ${like} OR e.employee_number ILIKE ${like})`);
  }

  const rows = (await tx.execute(sql`
    SELECT e.* FROM payroll_entries e
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY e.employee_name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map(mapEntry);
}

export async function getEntry(tx: Tx, entryId: string) {
  const [r] = (await tx.execute(sql`
    SELECT e.*, r.payroll_number, r.period_month, r.period_year,
           r.period_from, r.period_to, r.status AS run_status
      FROM payroll_entries e
      JOIN payroll_runs r ON r.id = e.payroll_run_id
     WHERE e.id = ${entryId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!r) return null;

  const lines = (await tx.execute(sql`
    SELECT id, kind, description, amount FROM payroll_entry_lines
     WHERE payroll_entry_id = ${entryId}::uuid
     ORDER BY kind, created_at
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    ...mapEntry(r),
    payrollNumber: String(r.payroll_number),
    month: Number(r.period_month),
    year: Number(r.period_year),
    label: periodLabel(Number(r.period_month), Number(r.period_year)),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    runStatus: String(r.run_status),
    lines: lines.map((l) => ({
      id: String(l.id),
      kind: String(l.kind),
      description: String(l.description),
      amount: Number(l.amount),
    })),
  };
}

function mapEntry(r: Record<string, unknown>) {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    id: String(r.id),
    payrollRunId: String(r.payroll_run_id),
    employeeId: String(r.employee_id),
    employeeNumber: String(r.employee_number),
    employeeName: String(r.employee_name),
    department: (r.department as string) ?? null,
    designation: (r.designation as string) ?? null,
    employmentType: (r.employment_type as string) ?? null,
    kraPin: (r.kra_pin as string) ?? null,
    nssfNumber: (r.nssf_number as string) ?? null,
    shaNumber: (r.sha_number as string) ?? null,
    bankName: (r.bank_name as string) ?? null,
    bankBranch: (r.bank_branch as string) ?? null,
    bankAccount: (r.bank_account as string) ?? null,
    mpesaNumber: (r.mpesa_number as string) ?? null,
    paymentMethod: String(r.payment_method),
    basicSalary: n("basic_salary"),
    housingAllowance: n("housing_allowance"),
    transportAllowance: n("transport_allowance"),
    medicalAllowance: n("medical_allowance"),
    otherAllowance: n("other_allowance"),
    overtimePay: n("overtime_pay"),
    bonus: n("bonus"),
    commission: n("commission"),
    additionalEarnings: n("additional_earnings"),
    grossPay: n("gross_pay"),
    paye: n("paye"),
    nssf: n("nssf"),
    shif: n("shif"),
    housingLevy: n("housing_levy"),
    insuranceRelief: n("insurance_relief"),
    loanRepayment: n("loan_repayment"),
    saccoDeduction: n("sacco_deduction"),
    additionalDeductions: n("additional_deductions"),
    totalDeductions: n("total_deductions"),
    employerNssf: n("employer_nssf"),
    employerHousingLevy: n("employer_housing_levy"),
    netPay: n("net_pay"),
    currency: String(r.currency),
    workingDaysTotal: r.working_days_total === null ? null : Number(r.working_days_total),
    workingDaysWorked: r.working_days_worked === null ? null : Number(r.working_days_worked),
    unpaidLeaveDays: n("unpaid_leave_days"),
    paymentStatus: String(r.payment_status),
    paidAt: r.paid_at ? new Date(r.paid_at as string).toISOString() : null,
    paymentReference: (r.payment_reference as string) ?? null,
    notes: (r.notes as string) ?? null,
  };
}

/** An employee's payslips, newest first — their salary history. */
export async function listEmployeePayslips(
  tx: Tx,
  input: { employeeId: string; limit?: number; year?: number | null },
) {
  const filters = [sql`e.employee_id = ${input.employeeId}::uuid`];
  if (input.year) filters.push(sql`r.period_year = ${input.year}`);

  const rows = (await tx.execute(sql`
    SELECT e.id, e.gross_pay, e.total_deductions, e.net_pay, e.payment_status,
           e.paye, e.nssf, e.shif, e.housing_levy,
           e.paid_at, r.id AS run_id, r.period_month, r.period_year, r.status AS run_status
      FROM payroll_entries e
      JOIN payroll_runs r ON r.id = e.payroll_run_id
     WHERE ${sql.join(filters, sql` AND `)}
       AND r.status <> 'voided'
     ORDER BY r.period_year DESC, r.period_month DESC
     LIMIT ${Math.min(Math.max(input.limit ?? 24, 1), 120)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    runId: String(r.run_id),
    month: Number(r.period_month),
    year: Number(r.period_year),
    label: periodLabel(Number(r.period_month), Number(r.period_year)),
    grossPay: Number(r.gross_pay),
    totalDeductions: Number(r.total_deductions),
    netPay: Number(r.net_pay),
    paye: Number(r.paye),
    nssf: Number(r.nssf),
    shif: Number(r.shif),
    housingLevy: Number(r.housing_levy),
    paymentStatus: String(r.payment_status),
    runStatus: String(r.run_status),
    paidAt: r.paid_at ? new Date(r.paid_at as string).toISOString() : null,
  }));
}

/**
 * A year of payslips for the P9A certificate.
 *
 * Voided runs are excluded — a payslip that was reversed out of the books is
 * not income, and the source's P9 route counts it.
 */
export async function getP9Data(
  tx: Tx,
  input: { employeeId: string; year: number },
) {
  const rows = (await tx.execute(sql`
    SELECT r.period_month, e.basic_salary, e.housing_allowance,
           e.transport_allowance, e.medical_allowance, e.other_allowance,
           e.overtime_pay, e.bonus, e.commission, e.additional_earnings,
           e.gross_pay, e.nssf, e.shif, e.housing_levy, e.paye,
           e.insurance_relief, e.net_pay
      FROM payroll_entries e
      JOIN payroll_runs r ON r.id = e.payroll_run_id
     WHERE e.employee_id = ${input.employeeId}::uuid
       AND r.period_year = ${input.year}
       AND r.status <> 'voided'
     ORDER BY r.period_month
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      month: Number(r.period_month),
      monthName: MONTHS[Number(r.period_month)],
      basicSalary: n("basic_salary"),
      allowances:
        n("housing_allowance") + n("transport_allowance") +
        n("medical_allowance") + n("other_allowance"),
      otherPay: n("overtime_pay") + n("bonus") + n("commission") + n("additional_earnings"),
      grossPay: n("gross_pay"),
      nssf: n("nssf"),
      shif: n("shif"),
      housingLevy: n("housing_levy"),
      taxablePay: Math.max(0, n("gross_pay") - n("nssf") - n("shif") - n("housing_levy")),
      paye: n("paye"),
      insuranceRelief: n("insurance_relief"),
      netPay: n("net_pay"),
    };
  });
}
