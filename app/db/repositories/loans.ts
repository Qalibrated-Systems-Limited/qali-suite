import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { loans, loanInstallments } from "../schema";
import { createJournalEntry, reverseJournalEntry } from "./journal";
import { getRatesForPeriod } from "./payroll";
import { likeContains } from "./sqlHelpers";

/**
 * Staff loans and salary advances.
 *
 * The balance is not stored: `loan_balances` sums the instalments (0048). So
 * nothing here maintains totalRepaid or outstandingBalance, and voiding a
 * payroll simply returns the instalments to pending — the source leaves them
 * marked deducted after reversing the journal, so the loan shows a repayment
 * that is no longer in the books.
 *
 * The schedule maths is carried over from loan.js unchanged.
 */

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
};

export interface Installment {
  month: number;
  year: number;
  sequence: number;
  principal: number;
  interest: number;
}

/**
 * Builds the repayment schedule.
 *
 * Three shapes, as in the source: equal principal with no interest, flat
 * interest spread evenly, and a reducing-balance EMI. The last instalment
 * absorbs the rounding in every case, so the schedule always sums to exactly
 * what was borrowed.
 */
export function buildSchedule(input: {
  principal: number;
  interestRate: number;
  interestType: "none" | "flat" | "reducing_balance";
  tenureMonths: number;
  startMonth: number;
  startYear: number;
}): Installment[] {
  const { principal, interestRate, interestType, tenureMonths } = input;
  const out: Installment[] = [];

  let month = input.startMonth;
  let year = input.startYear;
  const advance = () => {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  };

  if (interestType === "none" || interestRate === 0) {
    const monthly = Math.floor(principal / tenureMonths);
    const last = principal - monthly * (tenureMonths - 1);
    for (let i = 0; i < tenureMonths; i++) {
      out.push({
        month, year, sequence: i + 1,
        principal: i === tenureMonths - 1 ? last : monthly,
        interest: 0,
      });
      advance();
    }
    return out;
  }

  if (interestType === "flat") {
    const totalInterest = principal * interestRate * (tenureMonths / 12);
    const monthlyPrincipal = Math.floor(principal / tenureMonths);
    const monthlyInterest = Math.floor(totalInterest / tenureMonths);
    const lastPrincipal = principal - monthlyPrincipal * (tenureMonths - 1);
    const lastInterest =
      Math.round(totalInterest) - monthlyInterest * (tenureMonths - 1);

    for (let i = 0; i < tenureMonths; i++) {
      out.push({
        month, year, sequence: i + 1,
        principal: i === tenureMonths - 1 ? lastPrincipal : monthlyPrincipal,
        interest: i === tenureMonths - 1 ? lastInterest : monthlyInterest,
      });
      advance();
    }
    return out;
  }

  // Reducing balance: EMI = P·r·(1+r)^n / ((1+r)^n − 1)
  const r = interestRate / 12;
  const n = tenureMonths;
  const emi = Math.round((principal * r * (1 + r) ** n) / ((1 + r) ** n - 1));
  let remaining = principal;

  for (let i = 0; i < n; i++) {
    const interest = Math.round(remaining * r);
    const principalPart = i === n - 1 ? remaining : emi - interest;
    out.push({ month, year, sequence: i + 1, principal: principalPart, interest });
    remaining -= principalPart;
    advance();
  }
  return out;
}

export interface CreateLoanInput {
  companyId: string;
  employeeId: string;
  loanType: "salary_advance" | "staff_loan" | "sacco_deduction";
  principalAmount: number;
  interestRate?: number;
  interestType?: "none" | "flat" | "reducing_balance";
  tenureMonths: number;
  startMonth: number;
  startYear: number;
  purpose?: string | null;
  notes?: string | null;
  actor?: { id?: string | null; name?: string | null };
}

export async function createLoan(tx: Tx, input: CreateLoanInput) {
  if (!(input.principalAmount > 0)) {
    throw new Error("The loan amount must be more than zero.");
  }
  if (!(input.tenureMonths >= 1)) {
    throw new Error("The repayment period must be at least one month.");
  }

  const interestType = input.interestType ?? "none";
  const interestRate = interestType === "none" ? 0 : (input.interestRate ?? 0);

  /*
   * A LOAN THE EMPLOYEE CANNOT AFFORD IS NOT A LOAN.
   *
   * Kenya's Employment Act caps total deductions at two thirds of an
   * employee's wages. The source checks nothing at all, so a repayment can
   * exceed net pay and the payslip comes out negative — which the payroll
   * entry's own constraint would now refuse, at generation time, for a loan
   * that was approved months earlier.
   */
  const [emp] = (await tx.execute(sql`
    SELECT gross_salary, full_name FROM employees WHERE id = ${input.employeeId}::uuid
  `)) as unknown as Array<{ gross_salary: string; full_name: string }>;
  if (!emp) throw new Error("Employee not found");

  const schedule = buildSchedule({
    principal: input.principalAmount,
    interestRate,
    interestType,
    tenureMonths: input.tenureMonths,
    startMonth: input.startMonth,
    startYear: input.startYear,
  });

  const largest = Math.max(...schedule.map((i) => i.principal + i.interest));
  const gross = Number(emp.gross_salary);
  if (gross > 0 && largest > gross * (2 / 3)) {
    throw new Error(
      `A repayment of ${largest.toLocaleString()} is more than two thirds of ${emp.full_name}'s monthly pay. Lengthen the repayment period or reduce the amount.`,
    );
  }

  const [{ number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'LN') AS number`,
  )) as unknown as Array<{ number: string }>;

  const [loan] = await tx
    .insert(loans)
    .values({
      companyId: input.companyId,
      loanNumber: number,
      employeeId: input.employeeId,
      loanType: input.loanType,
      principalAmount: money(input.principalAmount),
      interestRate: String(interestRate),
      interestType,
      tenureMonths: input.tenureMonths,
      startMonth: input.startMonth,
      startYear: input.startYear,
      purpose: input.purpose ?? null,
      notes: input.notes ?? null,
      requestedById: input.actor?.id ?? null,
      requestedByName: input.actor?.name ?? null,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .returning();

  await tx.insert(loanInstallments).values(
    schedule.map((i) => ({
      companyId: input.companyId,
      loanId: loan.id,
      periodMonth: i.month,
      periodYear: i.year,
      sequence: i.sequence,
      principal: money(i.principal),
      interest: money(i.interest),
    })),
  );

  return loan;
}

export async function approveLoan(
  tx: Tx,
  input: { id: string; actor: { id: string; name: string } },
) {
  const loan = await getLoanRow(tx, input.id);
  if (!loan) throw new Error("Loan not found");
  if (loan.status !== "pending_approval") {
    throw new Error("Only a loan awaiting approval can be approved.");
  }

  const [updated] = await tx
    .update(loans)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedById: input.actor.id,
      approvedByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(loans.id, input.id))
    .returning();
  return updated;
}

export async function rejectLoan(
  tx: Tx,
  input: { id: string; reason: string; actor: { id: string; name: string } },
) {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("A rejection needs a reason.");

  const loan = await getLoanRow(tx, input.id);
  if (!loan) throw new Error("Loan not found");
  if (loan.status !== "pending_approval") {
    throw new Error("Only a loan awaiting approval can be rejected.");
  }

  const [updated] = await tx
    .update(loans)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedById: input.actor.id,
      rejectedByName: input.actor.name,
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(loans.id, input.id))
    .returning();
  return updated;
}

/**
 * Pays the money out, and posts it.
 *
 *   Dr staff loans receivable   principal
 *   Cr bank                     principal
 *
 * The journal is posted in the same transaction as the status change. The
 * source posts it separately and swallows a failure, so a loan could be marked
 * disbursed with nothing in the books.
 */
export async function disburseLoan(
  tx: Tx,
  input: {
    companyId: string;
    id: string;
    method: "bank" | "mpesa" | "cash" | "cheque";
    reference?: string | null;
    /** Overrides the payroll config's mapping. */
    bankAccountId?: string | null;
    staffLoansAccountId?: string | null;
    actor: { id: string; name: string };
  },
) {
  const loan = await getLoanRow(tx, input.id);
  if (!loan) throw new Error("Loan not found");
  if (loan.status !== "approved") {
    throw new Error("Only an approved loan can be disbursed.");
  }

  const today = new Date();
  const rates = await getRatesForPeriod(
    tx,
    today.getFullYear(),
    today.getMonth() + 1,
  );

  const receivable =
    input.staffLoansAccountId ||
    loan.staffLoansAccountId ||
    rates?.glMapping.staffLoansReceivable;
  const bank =
    input.bankAccountId || loan.bankAccountId || rates?.glMapping.bankAccount;

  if (!receivable || !bank) {
    throw new Error(
      "This loan cannot be paid out: the staff loans account or the bank account is not mapped. Map them under Settings → Payroll.",
    );
  }

  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: today.toISOString().slice(0, 10),
    entryType: "loan_disbursement",
    description: `Staff loan disbursed — ${loan.loanNumber} (${loan.employeeName})`,
    reference: loan.loanNumber,
    lines: [
      {
        accountId: receivable,
        debit: money(loan.principalAmount),
        credit: "0",
        description: `Loan to ${loan.employeeName}`,
      },
      {
        accountId: bank,
        debit: "0",
        credit: money(loan.principalAmount),
        description: `Loan paid out — ${input.method}`,
      },
    ],
    createdById: input.actor.id,
    postImmediately: true,
  });

  const [updated] = await tx
    .update(loans)
    .set({
      status: "active",
      disbursedAt: today,
      disbursedById: input.actor.id,
      disbursedByName: input.actor.name,
      disbursementMethod: input.method,
      disbursementReference: input.reference ?? null,
      staffLoansAccountId: receivable,
      bankAccountId: bank,
      updatedAt: new Date(),
    })
    .where(eq(loans.id, input.id))
    .returning();

  return { loan: updated, journalEntryId: entry.id };
}

/**
 * Cancels a loan.
 *
 * A disbursed loan cannot simply be cancelled — the money has gone out and the
 * receivable is on the balance sheet. The source allows it, leaving an asset
 * nothing will ever collect.
 */
export async function cancelLoan(
  tx: Tx,
  input: {
    companyId: string;
    id: string;
    reason?: string | null;
    actor: { id: string; name: string };
  },
) {
  const loan = await getLoanRow(tx, input.id);
  if (!loan) throw new Error("Loan not found");
  if (["fully_repaid", "cancelled", "rejected"].includes(loan.status)) {
    throw new Error("This loan is already closed.");
  }

  if (loan.status === "active" || loan.status === "disbursed") {
    if (loan.totalRepaid > 0) {
      throw new Error(
        "Repayments have already been made against this loan. Write it off through the ledger instead.",
      );
    }
    // Nothing repaid yet: reverse the disbursement so the receivable goes.
    const posted = (await tx.execute(sql`
      SELECT e.id FROM journal_entries e
       WHERE e.reference = ${loan.loanNumber}
         AND e.entry_type = 'loan_disbursement'
         AND e.status = 'posted'
    `)) as unknown as Array<{ id: string }>;
    for (const p of posted) {
      await reverseJournalEntry(
        tx,
        p.id,
        input.actor.id,
        `Loan cancelled: ${input.reason ?? "no reason given"}`,
      );
    }
  }

  await tx.execute(sql`
    UPDATE loan_installments SET status = 'skipped', updated_at = now()
     WHERE loan_id = ${input.id}::uuid AND status = 'pending'
  `);

  const [updated] = await tx
    .update(loans)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: input.actor.id,
      cancelledByName: input.actor.name,
      notes: input.reason ? `Cancelled: ${input.reason}` : loan.notes,
      updatedAt: new Date(),
    })
    .where(eq(loans.id, input.id))
    .returning();

  return updated;
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function getLoanRow(tx: Tx, id: string) {
  const [r] = (await tx.execute(sql`
    SELECT l.*, e.full_name AS employee_name,
           b.total_repaid, b.outstanding_balance
      FROM loans l
      JOIN employees e ON e.id = l.employee_id
      LEFT JOIN loan_balances b ON b.loan_id = l.id
     WHERE l.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!r) return null;
  return {
    id: String(r.id),
    loanNumber: String(r.loan_number),
    status: String(r.status),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    principalAmount: Number(r.principal_amount),
    notes: (r.notes as string) ?? null,
    staffLoansAccountId: (r.staff_loans_account_id as string) ?? null,
    bankAccountId: (r.bank_account_id as string) ?? null,
    totalRepaid: Number(r.total_repaid ?? 0),
    outstandingBalance: Number(r.outstanding_balance ?? 0),
  };
}

export async function listLoans(
  tx: Tx,
  opts: {
    status?: string | null;
    employeeId?: string | null;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const filters = [sql`TRUE`];
  if (opts.status) filters.push(sql`l.status = ${opts.status}`);
  if (opts.employeeId) filters.push(sql`l.employee_id = ${opts.employeeId}::uuid`);
  if (opts.search?.trim()) {
    const like = likeContains(opts.search.trim());
    filters.push(sql`(e.full_name ILIKE ${like} OR l.loan_number ILIKE ${like})`);
  }

  const rows = (await tx.execute(sql`
    SELECT l.id, l.loan_number, l.loan_type, l.status, l.principal_amount,
           l.interest_rate, l.interest_type, l.tenure_months,
           l.start_month, l.start_year, l.purpose, l.requested_at, l.disbursed_at,
           e.id AS employee_id, e.full_name AS employee_name, e.employee_number,
           d.name AS department,
           COALESCE(b.total_repaid, 0)        AS total_repaid,
           COALESCE(b.outstanding_balance, 0) AS outstanding_balance,
           COALESCE(b.monthly_installment, 0) AS monthly_installment,
           COALESCE(b.installments_pending, 0) AS installments_pending,
           COUNT(*) OVER () AS total
      FROM loans l
      JOIN employees e        ON e.id = l.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN loan_balances b ON b.loan_id = l.id
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY l.requested_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    rows: rows.map(mapLoan),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

function mapLoan(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    loanNumber: String(r.loan_number),
    loanType: String(r.loan_type),
    status: String(r.status),
    principalAmount: Number(r.principal_amount),
    interestRate: Number(r.interest_rate),
    interestType: String(r.interest_type),
    tenureMonths: Number(r.tenure_months),
    startMonth: Number(r.start_month),
    startYear: Number(r.start_year),
    purpose: (r.purpose as string) ?? null,
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    employeeNumber: String(r.employee_number),
    department: (r.department as string) ?? null,
    totalRepaid: Number(r.total_repaid),
    outstandingBalance: Number(r.outstanding_balance),
    monthlyInstallment: Number(r.monthly_installment),
    installmentsPending: Number(r.installments_pending),
    requestedAt: r.requested_at ? new Date(r.requested_at as string).toISOString() : null,
    disbursedAt: r.disbursed_at ? new Date(r.disbursed_at as string).toISOString() : null,
  };
}

export async function getLoan(tx: Tx, id: string) {
  const [r] = (await tx.execute(sql`
    SELECT l.*, e.full_name AS employee_name, e.employee_number,
           d.name AS department,
           COALESCE(b.total_repaid, 0)         AS total_repaid,
           COALESCE(b.interest_paid, 0)        AS interest_paid,
           COALESCE(b.outstanding_balance, 0)  AS outstanding_balance,
           COALESCE(b.monthly_installment, 0)  AS monthly_installment,
           COALESCE(b.installments_pending, 0) AS installments_pending,
           COALESCE(b.installments_paid, 0)    AS installments_paid
      FROM loans l
      JOIN employees e        ON e.id = l.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN loan_balances b ON b.loan_id = l.id
     WHERE l.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!r) return null;

  const schedule = (await tx.execute(sql`
    SELECT i.id, i.sequence, i.period_month, i.period_year, i.principal,
           i.interest, i.total, i.status, i.paid_at, r.payroll_number
      FROM loan_installments i
      LEFT JOIN payroll_runs r ON r.id = i.payroll_run_id
     WHERE i.loan_id = ${id}::uuid
     ORDER BY i.sequence
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    ...mapLoan(r),
    interestPaid: Number(r.interest_paid),
    installmentsPaid: Number(r.installments_paid),
    notes: (r.notes as string) ?? null,
    rejectionReason: (r.rejection_reason as string) ?? null,
    disbursementMethod: (r.disbursement_method as string) ?? null,
    disbursementReference: (r.disbursement_reference as string) ?? null,
    requestedByName: (r.requested_by_name as string) ?? null,
    approvedByName: (r.approved_by_name as string) ?? null,
    disbursedByName: (r.disbursed_by_name as string) ?? null,
    cancelledByName: (r.cancelled_by_name as string) ?? null,
    schedule: schedule.map((i) => ({
      id: String(i.id),
      sequence: Number(i.sequence),
      month: Number(i.period_month),
      year: Number(i.period_year),
      principal: Number(i.principal),
      interest: Number(i.interest),
      total: Number(i.total),
      status: String(i.status),
      paidAt: i.paid_at ? new Date(i.paid_at as string).toISOString() : null,
      payrollNumber: (i.payroll_number as string) ?? null,
    })),
  };
}

export async function getLoanStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE l.status = 'pending_approval')::int AS pending,
           COUNT(*) FILTER (WHERE l.status = 'approved')::int         AS approved,
           COUNT(*) FILTER (WHERE l.status IN ('disbursed','active'))::int AS active,
           COALESCE(SUM(b.outstanding_balance) FILTER (
             WHERE l.status IN ('disbursed','active')), 0) AS outstanding
      FROM loans l
      LEFT JOIN loan_balances b ON b.loan_id = l.id
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    pending: Number(row.pending),
    approved: Number(row.approved),
    active: Number(row.active),
    outstanding: Number(row.outstanding),
  };
}
