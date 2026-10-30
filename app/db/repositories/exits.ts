import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  employeeExits,
  employeeExitClearanceItems,
  employeeExitLines,
} from "../schema";
import { createJournalEntry } from "./journal";
import { getRatesForPeriod } from "./payroll";
import { terminateEmployee } from "./employees";
import { likeContains } from "./sqlHelpers";
import {
  computeFinalDues,
  untakenLeaveDays,
  EXIT_TYPE_LABELS,
} from "@/lib/hr/final-dues";

/**
 * Employee exits: the clearance, the final dues and the end of employment.
 *
 * A DRAFT holds the facts HR decides (type, dates, notice, overrides, manual
 * lines) and the clearance checklist. Its dues are computed on every read from
 * the current salary, leave, payslips and loans, so a draft never shows a
 * figure that has gone stale.
 *
 * APPROVING writes the statement, once, and the database freezes it. In the
 * same transaction: the employment ends, the accrual posts against the
 * payroll account mapping, and the loan instalments the dues recover are
 * marked as recovered by this exit. They succeed together or not at all.
 *
 * PAYING posts the payment. An exit with a net of nil is paid on approval.
 */

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
};
const trimmed = (v: string | null | undefined) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};
const today = () => new Date().toISOString().slice(0, 10);

type Actor = { id: string; name: string };

export const DEFAULT_CLEARANCE: Array<[string, string]> = [
  ["HR", "Resignation or termination letter on file"],
  ["HR", "Exit interview held"],
  ["Line manager", "Duties, files and work in progress handed over"],
  ["IT", "Laptop, phone and other ICT equipment returned"],
  ["IT", "System and email access revoked"],
  ["Admin", "Staff ID, keys and access cards returned"],
  ["Finance", "Imprest, advances and petty cash cleared"],
  ["Stores", "Tools, uniform and PPE returned"],
];

// ── Facts the dues are computed from ─────────────────────────────────────────

async function getExitRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(employeeExits).where(eq(employeeExits.id, id));
  return row ?? null;
}

async function getEmployeeFacts(tx: Tx, employeeId: string) {
  const [row] = (await tx.execute(sql`
    SELECT e.id, e.party_id, e.user_id, e.employee_number, e.full_name, e.status,
           e.hire_date::text AS hire_date, e.termination_date::text AS termination_date,
           e.designation, e.work_location, e.national_id, e.gross_salary,
           e.employment_type, d.name AS department
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = ${employeeId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

/**
 * Working days in [from, to], and the months' pay they amount to, each month
 * weighed by its own working days — the same `working_days()` payroll uses, so
 * the two cannot disagree about a month's length.
 */
async function workingSpan(tx: Tx, companyId: string, from: string, to: string) {
  if (to < from) return { days: 0, months: 0 };
  const [row] = (await tx.execute(sql`
    WITH m AS (
      SELECT gs::date AS month_start,
             (gs + interval '1 month - 1 day')::date AS month_end
        FROM generate_series(date_trunc('month', ${from}::date),
                             date_trunc('month', ${to}::date),
                             interval '1 month') AS gs
    )
    SELECT COALESCE(SUM(worked), 0) AS days,
           COALESCE(SUM(worked::numeric / NULLIF(total, 0)), 0) AS months
      FROM (
        SELECT working_days(${companyId}::uuid,
                            GREATEST(month_start, ${from}::date),
                            LEAST(month_end, ${to}::date)) AS worked,
               working_days(${companyId}::uuid, month_start, month_end) AS total
          FROM m
      ) x
  `)) as unknown as Array<{ days: string; months: string }>;
  return { days: Number(row?.days ?? 0), months: Number(row?.months ?? 0) };
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Everything the calculator needs, gathered for one exit. */
async function gatherFacts(tx: Tx, exit: typeof employeeExits.$inferSelect) {
  const warnings: string[] = [];
  const employee = await getEmployeeFacts(tx, exit.employeeId);
  if (!employee) throw new Error("Employee not found");

  const lwd = exit.lastWorkingDate;
  const year = Number(lwd.slice(0, 4));
  const month = Number(lwd.slice(5, 7));
  const hireDate = String(employee.hire_date);

  // Salary already paid: the end of the latest approved or paid period.
  const [paid] = (await tx.execute(sql`
    SELECT MAX(r.period_to)::text AS paid_to
      FROM payroll_entries pe
      JOIN payroll_runs r ON r.id = pe.payroll_run_id
     WHERE pe.employee_id = ${exit.employeeId}::uuid
       AND r.status IN ('approved', 'paid')
  `)) as unknown as Array<{ paid_to: string | null }>;
  const paidTo = paid?.paid_to ?? null;

  let unpaidFrom: string;
  if (paidTo) {
    unpaidFrom = addDays(paidTo, 1);
  } else {
    unpaidFrom = `${lwd.slice(0, 7)}-01`;
    warnings.push(
      "No payslip for this employee has been approved in QaliSuite, so salary is counted from the start of the month of leaving. Add earlier unpaid months as a manual line.",
    );
  }
  if (unpaidFrom < hireDate) unpaidFrom = hireDate;

  const unpaid = await workingSpan(tx, exit.companyId, unpaidFrom, lwd);
  const overpaid = paidTo && paidTo > lwd
    ? await workingSpan(tx, exit.companyId, addDays(lwd, 1), paidTo)
    : { days: 0, months: 0 };

  // A run still being prepared would pay them again when approved.
  const [pending] = (await tx.execute(sql`
    SELECT string_agg(r.payroll_number, ', ') AS runs
      FROM payroll_entries pe
      JOIN payroll_runs r ON r.id = pe.payroll_run_id
     WHERE pe.employee_id = ${exit.employeeId}::uuid
       AND r.status IN ('draft', 'processing', 'review')
  `)) as unknown as Array<{ runs: string | null }>;
  if (pending?.runs) {
    warnings.push(
      `This employee is on a payroll run still being prepared (${pending.runs}). Regenerate it after approving the exit, or they will be paid twice.`,
    );
  }

  // The payslip for the month of leaving, if one was issued: the dues are
  // taxed on top of it.
  const [mtd] = (await tx.execute(sql`
    SELECT SUM(pe.gross_pay) AS gross, SUM(pe.paye) AS paye, SUM(pe.nssf) AS nssf,
           SUM(pe.shif) AS shif, SUM(pe.housing_levy) AS ahl,
           SUM(pe.employer_nssf) AS employer_nssf,
           SUM(pe.employer_housing_levy) AS employer_ahl
      FROM payroll_entries pe
      JOIN payroll_runs r ON r.id = pe.payroll_run_id
     WHERE pe.employee_id = ${exit.employeeId}::uuid
       AND r.status IN ('approved', 'paid')
       AND r.period_year = ${year} AND r.period_month = ${month}
  `)) as unknown as Array<Record<string, string | null>>;
  const monthToDate =
    mtd && mtd.gross != null
      ? {
          pensionable: Number(mtd.gross),
          taxable:
            Number(mtd.gross) - Number(mtd.nssf) - Number(mtd.shif) - Number(mtd.ahl),
          paye: Number(mtd.paye),
          nssfEmployee: Number(mtd.nssf),
          nssfEmployer: Number(mtd.employer_nssf),
          shif: Number(mtd.shif),
          ahlEmployee: Number(mtd.ahl),
          ahlEmployer: Number(mtd.employer_ahl),
        }
      : null;

  // Annual leave earned to the last day and not taken.
  let leaveDays = 0;
  if (exit.leaveDaysOverride != null) {
    leaveDays = Number(exit.leaveDaysOverride);
  } else {
    const [leave] = (await tx.execute(sql`
      SELECT lt.default_entitlement,
             COALESCE(b.entitled_days, 0)   AS entitled_days,
             COALESCE(b.carry_over_days, 0) AS carry_over_days,
             COALESCE(b.taken_days, 0)      AS taken_days,
             COALESCE(b.encashed_days, 0)   AS encashed_days,
             COALESCE(b.pending_days, 0)    AS pending_days
        FROM leave_types lt
        LEFT JOIN leave_balances b
               ON b.leave_type_id = lt.id
              AND b.employee_id = ${exit.employeeId}::uuid
              AND b.year = ${year}
       WHERE lt.code = 'annual'
       LIMIT 1
    `)) as unknown as Array<Record<string, string>>;
    if (!leave) {
      warnings.push("There is no Annual Leave type, so no leave pay was computed.");
    } else {
      leaveDays = untakenLeaveDays({
        entitledDays: Number(leave.entitled_days),
        carryOverDays: Number(leave.carry_over_days),
        takenDays: Number(leave.taken_days),
        encashedDays: Number(leave.encashed_days),
        annualEntitlement: Number(leave.default_entitlement),
        hireDate,
        lastWorkingDate: lwd,
      });
      if (Number(leave.pending_days) > 0) {
        warnings.push(
          `${Number(leave.pending_days)} day(s) of annual leave are still awaiting approval. Decide them first: approved leave is not paid out.`,
        );
      }
    }
  }

  // Pending loan instalments, oldest first.
  const loanInstallments = (await tx.execute(sql`
    SELECT i.id, l.loan_number, i.total
      FROM loan_installments i
      JOIN loans l ON l.id = i.loan_id
     WHERE l.employee_id = ${exit.employeeId}::uuid
       AND l.status IN ('disbursed', 'active')
       AND i.status = 'pending'
     ORDER BY i.period_year, i.period_month, l.loan_number, i.sequence
  `)) as unknown as Array<{ id: string; loan_number: string; total: string }>;

  const manual = await tx
    .select()
    .from(employeeExitLines)
    .where(sql`${employeeExitLines.exitId} = ${exit.id}::uuid AND ${employeeExitLines.isManual}`)
    .orderBy(employeeExitLines.sortOrder);

  const rates = await getRatesForPeriod(tx, year, month);

  return {
    employee,
    rates,
    warnings,
    input: {
      exitType: exit.exitType,
      hireDate,
      lastWorkingDate: lwd,
      noticeDate: exit.noticeDate,
      noticePeriodDays: exit.noticePeriodDays,
      recoverNoticeShortfall: exit.recoverNoticeShortfall,
      monthlyGross: Number(employee.gross_salary ?? 0),
      dailyRateOverride: exit.dailyRate != null ? Number(exit.dailyRate) : null,
      salary: {
        unpaidWorkingDays: unpaid.days,
        unpaidMonths: unpaid.months,
        overpaidWorkingDays: overpaid.days,
        overpaidMonths: overpaid.months,
      },
      untakenLeaveDays: leaveDays,
      loanInstallments: loanInstallments.map((i) => ({
        id: i.id,
        loanNumber: i.loan_number,
        amount: Number(i.total),
      })),
      manualLines: manual.map((m) => ({
        id: m.id,
        kind: m.kind as "earning" | "deduction",
        description: m.description,
        amount: Number(m.amount),
        taxable: m.taxable,
        pensionable: m.pensionable,
        accountId: m.accountId,
      })),
      rates: rates ?? {},
      monthToDate,
    },
  };
}

/** The dues as they stand: computed for a draft, as approved otherwise. */
async function computeDues(tx: Tx, exit: typeof employeeExits.$inferSelect) {
  const facts = await gatherFacts(tx, exit);
  const result = computeFinalDues(facts.input);
  const warnings = [...facts.warnings, ...result.warnings];
  if (!facts.rates) {
    const m = exit.lastWorkingDate.slice(0, 7);
    warnings.unshift(
      `There are no payroll rates covering ${m}, so PAYE and the statutory deductions are nil. Set them under Settings → Payroll.`,
    );
  }
  return { ...result, warnings, facts };
}

// ── Numbering ────────────────────────────────────────────────────────────────

async function nextExitNumber(tx: Tx, companyId: string) {
  const [row] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'EX') AS number`,
  )) as unknown as Array<{ number: string }>;
  return row.number;
}

// ── Draft ────────────────────────────────────────────────────────────────────

export interface ExitInput {
  exitType: string;
  noticeDate?: string | null;
  lastWorkingDate: string;
  noticePeriodDays?: number | null;
  recoverNoticeShortfall?: boolean;
  dailyRate?: number | null;
  leaveDaysOverride?: number | null;
  reason?: string | null;
  exitInterviewNotes?: string | null;
}

function validate(input: ExitInput, hireDate: string) {
  if (!(input.exitType in EXIT_TYPE_LABELS)) throw new Error("Choose how the employment is ending.");
  if (!input.lastWorkingDate) throw new Error("Enter the last working day.");
  if (input.lastWorkingDate < hireDate) {
    throw new Error("The last working day cannot fall before the hire date.");
  }
  if (input.noticeDate && input.noticeDate > input.lastWorkingDate) {
    throw new Error("Notice cannot be given after the last working day.");
  }
}

export async function createExit(
  tx: Tx,
  input: ExitInput & { companyId: string; employeeId: string; actor: Actor },
) {
  const employee = await getEmployeeFacts(tx, input.employeeId);
  if (!employee) throw new Error("Employee not found");
  validate(input, String(employee.hire_date));

  const [live] = (await tx.execute(sql`
    SELECT exit_number FROM employee_exits
     WHERE employee_id = ${input.employeeId}::uuid AND status <> 'cancelled'
  `)) as unknown as Array<{ exit_number: string }>;
  if (live) {
    throw new Error(`${employee.full_name} already has an exit in progress (${live.exit_number}).`);
  }

  const [exit] = await tx
    .insert(employeeExits)
    .values({
      companyId: input.companyId,
      exitNumber: await nextExitNumber(tx, input.companyId),
      employeeId: input.employeeId,
      exitType: input.exitType,
      noticeDate: trimmed(input.noticeDate),
      lastWorkingDate: input.lastWorkingDate,
      noticePeriodDays: input.noticePeriodDays ?? 28,
      recoverNoticeShortfall: input.recoverNoticeShortfall ?? false,
      dailyRate: input.dailyRate ? money(input.dailyRate) : null,
      leaveDaysOverride: input.leaveDaysOverride != null ? String(input.leaveDaysOverride) : null,
      reason: trimmed(input.reason),
      exitInterviewNotes: trimmed(input.exitInterviewNotes),
      createdById: input.actor.id,
      createdByName: input.actor.name,
      lastModifiedById: input.actor.id,
      lastModifiedByName: input.actor.name,
    })
    .returning();

  // The standard checklist, then every company asset still in their custody.
  const assets = (await tx.execute(sql`
    SELECT id, asset_number, name FROM assets
     WHERE assigned_to_party_id = ${String(employee.party_id)}::uuid
       AND status NOT IN ('disposed', 'written_off')
     ORDER BY asset_number
  `)) as unknown as Array<{ id: string; asset_number: string; name: string }>;

  const items = [
    ...DEFAULT_CLEARANCE.map(([area, item]) => ({ area, item, assetId: null as string | null })),
    ...assets.map((a) => ({
      area: "Assets",
      item: `Return ${a.asset_number} — ${a.name}`,
      assetId: a.id,
    })),
  ];
  await tx.insert(employeeExitClearanceItems).values(
    items.map((it, i) => ({
      companyId: input.companyId,
      exitId: exit.id,
      area: it.area,
      item: it.item,
      assetId: it.assetId,
      sortOrder: i,
    })),
  );

  return exit;
}

async function requireDraft(tx: Tx, id: string) {
  const exit = await getExitRow(tx, id);
  if (!exit) throw new Error("Exit not found");
  if (exit.status !== "draft") {
    throw new Error(`This exit is ${exit.status} and can no longer be changed.`);
  }
  return exit;
}

export async function updateExit(
  tx: Tx,
  input: ExitInput & { id: string; actor: Actor },
) {
  const exit = await requireDraft(tx, input.id);
  const employee = await getEmployeeFacts(tx, exit.employeeId);
  validate(input, String(employee?.hire_date));

  const [updated] = await tx
    .update(employeeExits)
    .set({
      exitType: input.exitType,
      noticeDate: trimmed(input.noticeDate),
      lastWorkingDate: input.lastWorkingDate,
      noticePeriodDays: input.noticePeriodDays ?? exit.noticePeriodDays,
      recoverNoticeShortfall: input.recoverNoticeShortfall ?? false,
      dailyRate: input.dailyRate ? money(input.dailyRate) : null,
      leaveDaysOverride: input.leaveDaysOverride != null ? String(input.leaveDaysOverride) : null,
      reason: trimmed(input.reason),
      exitInterviewNotes: trimmed(input.exitInterviewNotes),
      lastModifiedById: input.actor.id,
      lastModifiedByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(employeeExits.id, input.id))
    .returning();
  return updated;
}

export async function addManualLine(
  tx: Tx,
  input: {
    companyId: string;
    exitId: string;
    kind: "earning" | "deduction";
    description: string;
    amount: number;
    taxable?: boolean;
    pensionable?: boolean;
    accountId?: string | null;
  },
) {
  await requireDraft(tx, input.exitId);
  if (!trimmed(input.description)) throw new Error("Describe the line.");
  if (!(input.amount > 0)) throw new Error("Enter an amount above zero.");
  if (input.kind === "deduction" && !input.accountId) {
    throw new Error("Choose the account a deduction is credited to.");
  }
  const [line] = await tx
    .insert(employeeExitLines)
    .values({
      companyId: input.companyId,
      exitId: input.exitId,
      kind: input.kind,
      code: "manual",
      description: input.description.trim(),
      amount: money(input.amount),
      taxable: input.taxable ?? input.kind === "earning",
      pensionable: input.pensionable ?? input.kind === "earning",
      accountId: input.accountId ?? null,
      isManual: true,
      sortOrder: 1000,
    })
    .returning();
  return line;
}

export async function removeManualLine(tx: Tx, lineId: string) {
  const [line] = await tx
    .select()
    .from(employeeExitLines)
    .where(eq(employeeExitLines.id, lineId));
  if (!line || !line.isManual) throw new Error("Line not found");
  await requireDraft(tx, line.exitId);
  await tx.delete(employeeExitLines).where(eq(employeeExitLines.id, lineId));
  return line;
}

// ── Clearance ────────────────────────────────────────────────────────────────

export async function addClearanceItem(
  tx: Tx,
  input: { companyId: string; exitId: string; area: string; item: string },
) {
  await requireDraft(tx, input.exitId);
  if (!trimmed(input.area) || !trimmed(input.item)) {
    throw new Error("Enter the area and what has to be cleared.");
  }
  const [{ next }] = (await tx.execute(sql`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
      FROM employee_exit_clearance_items WHERE exit_id = ${input.exitId}::uuid
  `)) as unknown as Array<{ next: number }>;
  const [row] = await tx
    .insert(employeeExitClearanceItems)
    .values({
      companyId: input.companyId,
      exitId: input.exitId,
      area: input.area.trim(),
      item: input.item.trim(),
      sortOrder: Number(next),
    })
    .returning();
  return row;
}

export async function setClearanceStatus(
  tx: Tx,
  input: {
    itemId: string;
    status: "pending" | "cleared" | "waived";
    note?: string | null;
    actor: Actor;
  },
) {
  const [item] = await tx
    .select()
    .from(employeeExitClearanceItems)
    .where(eq(employeeExitClearanceItems.id, input.itemId));
  if (!item) throw new Error("Clearance item not found");
  await requireDraft(tx, item.exitId);
  if (input.status === "waived" && !trimmed(input.note)) {
    throw new Error("Say why this item is being waived.");
  }
  const signed = input.status !== "pending";
  const [row] = await tx
    .update(employeeExitClearanceItems)
    .set({
      status: input.status,
      note: trimmed(input.note) ?? (input.status === "waived" ? null : item.note),
      clearedAt: signed ? new Date() : null,
      clearedById: signed ? input.actor.id : null,
      clearedByName: signed ? input.actor.name : null,
    })
    .where(eq(employeeExitClearanceItems.id, input.itemId))
    .returning();
  return row;
}

export async function removeClearanceItem(tx: Tx, itemId: string) {
  const [item] = await tx
    .select()
    .from(employeeExitClearanceItems)
    .where(eq(employeeExitClearanceItems.id, itemId));
  if (!item) throw new Error("Clearance item not found");
  await requireDraft(tx, item.exitId);
  if (item.status !== "pending") {
    throw new Error("Only an item not yet signed off can be removed.");
  }
  await tx.delete(employeeExitClearanceItems).where(eq(employeeExitClearanceItems.id, itemId));
  return item;
}

// ── Approve, pay, cancel ─────────────────────────────────────────────────────

/**
 * Freezes the dues, ends the employment and posts the accrual.
 *
 *   Dr Salary expense         earnings, less salary or leave overpaid
 *   Dr Employer NSSF expense
 *   Dr Employer AHL expense
 *   Cr PAYE / NSSF / SHIF / AHL payable
 *   Cr Staff loans receivable  the instalments recovered
 *   Cr <chosen account>        each manual deduction
 *   Cr Salary expense          notice the employee did not serve
 *   Cr Salaries payable        net
 */
export async function approveExit(
  tx: Tx,
  input: { companyId: string; id: string; actor: Actor },
) {
  const exit = await requireDraft(tx, input.id);

  const [{ open }] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS open FROM employee_exit_clearance_items
     WHERE exit_id = ${exit.id}::uuid AND status = 'pending'
  `)) as unknown as Array<{ open: number }>;
  if (open > 0) {
    throw new Error(
      `${open} clearance item(s) are still pending. Clear or waive them before approving the final dues.`,
    );
  }

  const dues = await computeDues(tx, exit);
  const { totals, facts } = dues;
  if (!facts.rates) {
    throw new Error(
      `There are no payroll rates covering ${exit.lastWorkingDate.slice(0, 7)}. Set them under Settings → Payroll.`,
    );
  }
  if (totals.net < 0) {
    throw new Error("Deductions exceed earnings. Reduce the deductions before approving.");
  }

  const gl = facts.rates.glMapping;
  const label = `${exit.exitNumber} — ${facts.employee.full_name}`;
  const line = (accountId: string | null, debit: number, credit: number, description: string) => ({
    accountId: accountId as string,
    debit: money(debit),
    credit: money(credit),
    description,
  });

  const lines = dues.lines;
  const sumOf = (pred: (l: (typeof lines)[number]) => boolean) =>
    lines.filter(pred).reduce((s, l) => s + l.amount, 0);
  const noticeRecovery = sumOf((l) => l.code === "notice_recovery");
  const salaryExpense = totals.grossEarnings;
  const manualDeductions = lines.filter((l) => l.kind === "deduction" && l.isManual);

  const required: Array<[string, string | null, number, "debit" | "credit", string]> = [
    ["Salary expense", gl.salaryExpense, salaryExpense - noticeRecovery, "debit", `Final dues — ${label}`],
    ["Employer NSSF expense", gl.employerNssfExpense, totals.employerNssf, "debit", `Employer NSSF — ${label}`],
    ["Employer AHL expense", gl.employerAhlExpense, totals.employerHousingLevy, "debit", `Employer AHL — ${label}`],
    ["PAYE payable", gl.payePayable, totals.paye, "credit", `PAYE — ${label}`],
    ["NSSF payable", gl.nssfPayable, totals.nssf + totals.employerNssf, "credit", `NSSF — ${label}`],
    ["SHIF payable", gl.shifPayable, totals.shif, "credit", `SHIF — ${label}`],
    ["AHL payable", gl.ahlPayable, totals.housingLevy + totals.employerHousingLevy, "credit", `AHL — ${label}`],
    ["Staff loans receivable", gl.staffLoansReceivable, totals.loanRecovery, "credit", `Loan recovery — ${label}`],
    ["Salaries payable", gl.salaryPayable, totals.net, "credit", `Final dues payable — ${label}`],
  ];
  const unmapped = required
    .filter(([, account, amount]) => Math.abs(amount) > 0.0001 && !account)
    .map(([name]) => name);
  if (unmapped.length) {
    throw new Error(
      `Final dues cannot post: ${unmapped.join(", ")} ${unmapped.length === 1 ? "is" : "are"} not mapped to an account. Map ${unmapped.length === 1 ? "it" : "them"} under Settings → Payroll.`,
    );
  }

  const journalLines = [
    ...required
      .filter(([, account, amount]) => Math.abs(amount) > 0.0001 && account)
      .map(([, account, amount, side, description]) => {
        // Salary expense nets to a credit only if recoveries exceed pay,
        // which a non-negative net already rules out; kept honest anyway.
        if (amount < 0) {
          return line(account, side === "debit" ? 0 : -amount, side === "debit" ? -amount : 0, description);
        }
        return line(account, side === "debit" ? amount : 0, side === "credit" ? amount : 0, description);
      }),
    ...manualDeductions.map((l) => line(l.accountId, 0, l.amount, `${l.description} — ${label}`)),
  ];

  const entry = journalLines.length
    ? await createJournalEntry(tx, {
        companyId: input.companyId,
        entryDate: today(),
        entryType: "payroll",
        description: `Final dues — ${label}`,
        reference: exit.exitNumber,
        lines: journalLines,
        createdById: input.actor.id,
        postImmediately: true,
      })
    : null;
  if (!entry) throw new Error("There is nothing to post: the dues are all nil.");

  // The statement, frozen from here by the trigger once the status moves.
  await tx.delete(employeeExitLines).where(eq(employeeExitLines.exitId, exit.id));
  if (lines.length) {
    await tx.insert(employeeExitLines).values(
      lines.map((l) => ({
        companyId: input.companyId,
        exitId: exit.id,
        kind: l.kind,
        code: l.code,
        description: l.description,
        quantity: l.quantity != null ? String(l.quantity) : null,
        rate: l.rate != null ? money(l.rate) : null,
        amount: money(l.amount),
        taxable: l.taxable,
        pensionable: l.pensionable,
        accountId: l.accountId ?? null,
        isManual: l.isManual,
        sortOrder: l.sortOrder,
      })),
    );
  }

  if (dues.loanInstallmentIds.length) {
    await tx.execute(sql`
      UPDATE loan_installments
         SET status = 'deducted', exit_id = ${exit.id}::uuid,
             paid_at = now(), updated_at = now()
       WHERE id IN (${sql.join(dues.loanInstallmentIds.map((i: string) => sql`${i}::uuid`), sql`, `)})
         AND status = 'pending'
    `);
    await tx.execute(sql`
      UPDATE loans l
         SET status = 'fully_repaid', updated_at = now()
       WHERE l.employee_id = ${exit.employeeId}::uuid
         AND l.status IN ('disbursed', 'active')
         AND NOT EXISTS (SELECT 1 FROM loan_installments i
                          WHERE i.loan_id = l.id AND i.status = 'pending')
         AND EXISTS (SELECT 1 FROM loan_installments i WHERE i.loan_id = l.id)
    `);
  }

  // The employment ends on the last working day. An employee terminated
  // before exits existed keeps the date they were given.
  if (facts.employee.status !== "terminated") {
    await terminateEmployee(tx, {
      id: exit.employeeId,
      companyId: input.companyId,
      terminationDate: exit.lastWorkingDate,
      reason: [EXIT_TYPE_LABELS[exit.exitType as keyof typeof EXIT_TYPE_LABELS], exit.reason]
        .filter(Boolean)
        .join(" — "),
      actor: input.actor,
    });
  }

  const nil = Math.abs(totals.net) < 0.005;
  const [updated] = await tx
    .update(employeeExits)
    .set({
      status: nil ? "paid" : "approved",
      grossEarnings: money(totals.grossEarnings),
      paye: money(totals.paye),
      nssf: money(totals.nssf),
      shif: money(totals.shif),
      housingLevy: money(totals.housingLevy),
      employerNssf: money(totals.employerNssf),
      employerHousingLevy: money(totals.employerHousingLevy),
      otherDeductions: money(totals.otherDeductions),
      netPay: money(totals.net),
      accrualJournalEntryId: entry.id,
      approvedAt: new Date(),
      approvedById: input.actor.id,
      approvedByName: input.actor.name,
      ...(nil ? { paidAt: new Date(), paidById: input.actor.id, paidByName: input.actor.name } : {}),
      lastModifiedById: input.actor.id,
      lastModifiedByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(employeeExits.id, exit.id))
    .returning();

  return {
    exit: updated,
    journalEntryId: entry.id,
    userId: (facts.employee.user_id as string | null) ?? null,
    loansRecovered: dues.loanInstallmentIds.length,
  };
}

export async function payExit(
  tx: Tx,
  input: { companyId: string; id: string; paymentReference?: string | null; actor: Actor },
) {
  const exit = await getExitRow(tx, input.id);
  if (!exit) throw new Error("Exit not found");
  if (exit.status !== "approved") throw new Error("Only approved final dues can be paid.");

  const year = Number(exit.lastWorkingDate.slice(0, 4));
  const month = Number(exit.lastWorkingDate.slice(5, 7));
  const rates = await getRatesForPeriod(tx, year, month);
  const gl = rates?.glMapping;
  if (!gl?.salaryPayable || !gl?.bankAccount) {
    throw new Error(
      "Final dues cannot be paid: the salaries payable account or the bank account is not mapped. Map them under Settings → Payroll.",
    );
  }

  const net = Number(exit.netPay);
  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: today(),
    entryType: "payroll",
    description: `Final dues paid — ${exit.exitNumber}`,
    reference: trimmed(input.paymentReference) ?? exit.exitNumber,
    lines: [
      { accountId: gl.salaryPayable, debit: money(net), credit: "0", description: `Final dues payable cleared — ${exit.exitNumber}` },
      { accountId: gl.bankAccount, debit: "0", credit: money(net), description: `Final dues paid — ${exit.exitNumber}` },
    ],
    createdById: input.actor.id,
    postImmediately: true,
  });

  const [updated] = await tx
    .update(employeeExits)
    .set({
      status: "paid",
      paymentJournalEntryId: entry.id,
      paymentReference: trimmed(input.paymentReference),
      paidAt: new Date(),
      paidById: input.actor.id,
      paidByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(employeeExits.id, exit.id))
    .returning();
  return { exit: updated, journalEntryId: entry.id };
}

export async function cancelExit(
  tx: Tx,
  input: { id: string; reason: string; actor: Actor },
) {
  await requireDraft(tx, input.id);
  if (!trimmed(input.reason)) throw new Error("Say why the exit is being cancelled.");
  const [updated] = await tx
    .update(employeeExits)
    .set({
      status: "cancelled",
      cancellationReason: input.reason.trim(),
      cancelledAt: new Date(),
      cancelledById: input.actor.id,
      cancelledByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(employeeExits.id, input.id))
    .returning();
  return updated;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listExits(
  tx: Tx,
  opts: { status?: string | null; search?: string; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters = [sql`TRUE`];
  if (opts.status) filters.push(sql`x.status = ${opts.status}`);
  if (opts.search?.trim()) {
    const like = likeContains(opts.search.trim());
    filters.push(sql`(e.full_name ILIKE ${like} OR x.exit_number ILIKE ${like} OR e.employee_number ILIKE ${like})`);
  }
  const rows = (await tx.execute(sql`
    SELECT x.id, x.exit_number, x.exit_type, x.status,
           x.last_working_date::text AS last_working_date, x.net_pay,
           e.id AS employee_id, e.full_name, e.employee_number, d.name AS department,
           (SELECT COUNT(*) FROM employee_exit_clearance_items c
             WHERE c.exit_id = x.id AND c.status = 'pending')::int AS clearance_open,
           COUNT(*) OVER () AS total
      FROM employee_exits x
      JOIN employees e ON e.id = x.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY x.created_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      exitNumber: String(r.exit_number),
      exitType: String(r.exit_type),
      status: String(r.status),
      lastWorkingDate: String(r.last_working_date),
      netPay: Number(r.net_pay),
      employeeId: String(r.employee_id),
      employeeName: String(r.full_name),
      employeeNumber: String(r.employee_number),
      department: (r.department as string) ?? null,
      clearanceOpen: Number(r.clearance_open),
    })),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

export async function getExit(tx: Tx, id: string) {
  const exit = await getExitRow(tx, id);
  if (!exit) return null;
  const employee = await getEmployeeFacts(tx, exit.employeeId);
  const clearance = await tx
    .select()
    .from(employeeExitClearanceItems)
    .where(eq(employeeExitClearanceItems.exitId, id))
    .orderBy(employeeExitClearanceItems.sortOrder);

  let dues;
  if (exit.status === "draft") {
    const live = await computeDues(tx, exit);
    const manualIds = live.facts.input.manualLines.map((m) => m.id);
    let manualIndex = 0;
    dues = {
      live: true,
      dailyRate: live.dailyRate,
      dailyRateBasis: live.dailyRateBasis,
      noticeServedDays: live.noticeServedDays,
      noticeShortfallDays: live.noticeShortfallDays,
      untakenLeaveDays: live.facts.input.untakenLeaveDays,
      // A manual line keeps its id so the screen can remove it.
      lines: live.lines.map((l) => ({
        ...l,
        id: l.isManual ? manualIds[manualIndex++] ?? null : null,
      })),
      totals: live.totals,
      warnings: live.warnings,
    };
  } else {
    const stored = await tx
      .select()
      .from(employeeExitLines)
      .where(eq(employeeExitLines.exitId, id))
      .orderBy(employeeExitLines.sortOrder);
    dues = {
      live: false,
      dailyRate: exit.dailyRate != null ? Number(exit.dailyRate) : null,
      dailyRateBasis: null,
      noticeServedDays: null,
      noticeShortfallDays: null,
      untakenLeaveDays: null,
      lines: stored.map((l) => ({
        id: l.id,
        kind: l.kind,
        code: l.code,
        description: l.description,
        quantity: l.quantity != null ? Number(l.quantity) : null,
        rate: l.rate != null ? Number(l.rate) : null,
        amount: Number(l.amount),
        taxable: l.taxable,
        pensionable: l.pensionable,
        accountId: l.accountId,
        isManual: l.isManual,
      })),
      totals: {
        grossEarnings: Number(exit.grossEarnings),
        paye: Number(exit.paye),
        nssf: Number(exit.nssf),
        shif: Number(exit.shif),
        housingLevy: Number(exit.housingLevy),
        employerNssf: Number(exit.employerNssf),
        employerHousingLevy: Number(exit.employerHousingLevy),
        otherDeductions: Number(exit.otherDeductions),
        net: Number(exit.netPay),
      },
      warnings: [],
    };
  }

  return {
    exit: {
      ...exit,
      exitTypeLabel: EXIT_TYPE_LABELS[exit.exitType as keyof typeof EXIT_TYPE_LABELS] ?? exit.exitType,
    },
    employee: employee
      ? {
          id: String(employee.id),
          fullName: String(employee.full_name),
          employeeNumber: String(employee.employee_number),
          designation: (employee.designation as string) ?? null,
          department: (employee.department as string) ?? null,
          hireDate: String(employee.hire_date),
          status: String(employee.status),
          monthlyGross: Number(employee.gross_salary ?? 0),
        }
      : null,
    clearance,
    dues,
  };
}

export async function getExitForEmployee(tx: Tx, employeeId: string) {
  const [row] = (await tx.execute(sql`
    SELECT id, exit_number, status FROM employee_exits
     WHERE employee_id = ${employeeId}::uuid AND status <> 'cancelled'
     LIMIT 1
  `)) as unknown as Array<{ id: string; exit_number: string; status: string }>;
  return row ? { id: row.id, exitNumber: row.exit_number, status: row.status } : null;
}

/**
 * What s.51(2) requires a certificate of service to state, and nothing it
 * does not: the employer and its postal address, the employee, when the
 * employment began and ended, and the nature and usual place of the work.
 * No reason for leaving and no remark on conduct.
 */
export async function getCertificateOfServiceData(tx: Tx, employeeId: string) {
  const employee = await getEmployeeFacts(tx, employeeId);
  if (!employee) throw new Error("Employee not found");
  if (employee.status !== "terminated" || !employee.termination_date) {
    throw new Error(
      "A certificate of service is issued when the employment ends. Approve the exit first.",
    );
  }

  const [company] = (await tx.execute(sql`
    SELECT c.name, c.street, c.city, c.postal_code, c.country, c.email, c.phone,
           c.tax_pin, c.registration_number
      FROM companies c
     WHERE c.id = NULLIF(current_setting('app.company_id', true), '')::uuid
  `)) as unknown as Array<Record<string, string | null>>;

  // The positions held, oldest first: the hire, then each designation change.
  const history = (await tx.execute(sql`
    SELECT event_type, field, previous_value, new_value, effective_date::text AS effective_date
      FROM employment_events
     WHERE employee_id = ${employeeId}::uuid
       AND (field = 'designation' OR event_type IN ('promotion', 'designation_change'))
     ORDER BY effective_date, created_at
  `)) as unknown as Array<Record<string, string | null>>;

  const positions: Array<{ title: string; from: string }> = [];
  const firstTitle = history.find((h) => h.previous_value)?.previous_value;
  positions.push({
    title: firstTitle ?? (employee.designation as string) ?? "—",
    from: String(employee.hire_date),
  });
  for (const h of history) {
    if (h.new_value && h.new_value !== positions[positions.length - 1].title) {
      positions.push({ title: h.new_value, from: String(h.effective_date) });
    }
  }

  const [exit] = (await tx.execute(sql`
    SELECT exit_number FROM employee_exits
     WHERE employee_id = ${employeeId}::uuid AND status IN ('approved', 'paid')
     LIMIT 1
  `)) as unknown as Array<{ exit_number: string }>;

  return {
    company: company ?? null,
    employee: {
      fullName: String(employee.full_name),
      employeeNumber: String(employee.employee_number),
      nationalId: (employee.national_id as string) ?? null,
      designation: (employee.designation as string) ?? null,
      department: (employee.department as string) ?? null,
      workLocation: (employee.work_location as string) ?? null,
      employmentType: (employee.employment_type as string) ?? null,
      hireDate: String(employee.hire_date),
      terminationDate: String(employee.termination_date),
    },
    positions,
    reference: exit?.exit_number ?? null,
  };
}

/** Employees who can be given an exit: anyone without one already live. */
export async function listEmployeesForExit(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT e.id, e.full_name, e.employee_number, e.status, d.name AS department
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE NOT EXISTS (
       SELECT 1 FROM employee_exits x
        WHERE x.employee_id = e.id AND x.status <> 'cancelled'
     )
     ORDER BY e.status = 'terminated', e.full_name
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.full_name),
    employeeNumber: String(r.employee_number),
    status: String(r.status),
    department: (r.department as string) ?? null,
  }));
}

/** Accounts a manual deduction can be credited to. */
export async function listPostingAccounts(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT id, account_code, account_name FROM accounts
     WHERE is_active AND can_post
     ORDER BY account_code
  `)) as unknown as Array<{ id: string; account_code: string; account_name: string }>;
  return rows.map((r) => ({ id: r.id, code: r.account_code, name: r.account_name }));
}
