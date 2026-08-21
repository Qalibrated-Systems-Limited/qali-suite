"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { roleAllowed } from "@/lib/permissions";
import { userMessage } from "../errors";
import * as loans from "../repositories/loans";
import * as employees from "../repositories/employees";
import * as accounts from "../repositories/accounts";

/**
 * Postgres-backed staff loan actions.
 *
 * Requesting, approving and paying out are three different authorities, which
 * is the point of the workflow: the person who asks for a loan is not the
 * person who approves it, and neither is the person who releases the money.
 */

const REQUEST_ROLES = ["SuperAdmin", "Admin", "HR Manager", "Manager"];
const APPROVE_ROLES = ["SuperAdmin", "Admin", "CFO", "Finance Manager"];
const DISBURSE_ROLES = ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"];

export type ActionResult =
  | { success: true; id?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const num = (fd: FormData, key: string, fallback = 0) => {
  const n = Number(str(fd, key));
  return Number.isFinite(n) ? n : fallback;
};

export async function createLoanRequest(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const employeeId = str(formData, "employeeId");
  const principal = num(formData, "principalAmount");
  const tenure = num(formData, "tenureMonths");

  const fieldErrors: Record<string, string> = {};
  if (!employeeId) fieldErrors.employeeId = "Choose an employee";
  if (!(principal > 0)) fieldErrors.principalAmount = "Enter an amount";
  if (!(tenure >= 1)) fieldErrors.tenureMonths = "Enter a repayment period";
  if (Object.keys(fieldErrors).length) {
    return { success: false, error: "Please fill in all required fields", fieldErrors };
  }

  const now = new Date();
  let id: string;
  try {
    const loan = await withAuthorizedTenant(REQUEST_ROLES, (tx, { user, companyId }) =>
      loans.createLoan(tx, {
        companyId,
        employeeId,
        loanType: (str(formData, "loanType") || "staff_loan") as
          | "salary_advance"
          | "staff_loan"
          | "sacco_deduction",
        principalAmount: principal,
        interestRate: num(formData, "interestRate"),
        interestType: (str(formData, "interestType") || "none") as
          | "none"
          | "flat"
          | "reducing_balance",
        tenureMonths: tenure,
        startMonth: num(formData, "startMonth", now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2),
        startYear: num(formData, "startYear", now.getFullYear()),
        purpose: str(formData, "purpose") || null,
        notes: str(formData, "notes") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
    id = loan.id;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not raise the loan request.") };
  }

  revalidatePath("/dashboard/hr/loans");
  redirect(`/dashboard/hr/loans/${id}`);
}

export async function approveLoan(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(APPROVE_ROLES, (tx, { user }) =>
      loans.approveLoan(tx, { id, actor: { id: user.id, name: user.name } }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not approve the loan.") };
  }
  revalidateLoan(id);
  return { success: true, id };
}

export async function rejectLoan(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "loanId");
  const reason = str(formData, "reason");
  if (!id) return { success: false, error: "Loan ID is required" };
  if (!reason) {
    return {
      success: false,
      error: "A rejection needs a reason",
      fieldErrors: { reason: "Required" },
    };
  }

  try {
    await withAuthorizedTenant(APPROVE_ROLES, (tx, { user }) =>
      loans.rejectLoan(tx, { id, reason, actor: { id: user.id, name: user.name } }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not reject the loan.") };
  }
  revalidateLoan(id);
  return { success: true, id };
}

export async function disburseLoan(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "loanId");
  if (!id) return { success: false, error: "Loan ID is required" };

  try {
    await withAuthorizedTenant(DISBURSE_ROLES, (tx, { user, companyId }) =>
      loans.disburseLoan(tx, {
        companyId,
        id,
        method: (str(formData, "method") || "bank") as "bank" | "mpesa" | "cash" | "cheque",
        reference: str(formData, "reference") || null,
        bankAccountId: str(formData, "bankAccountId") || null,
        staffLoansAccountId: str(formData, "staffLoansAccountId") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not pay out the loan.") };
  }
  revalidateLoan(id);
  return { success: true, id, message: "Paid out and posted to the ledger." };
}

export async function cancelLoan(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "loanId");
  if (!id) return { success: false, error: "Loan ID is required" };

  try {
    await withAuthorizedTenant(APPROVE_ROLES, (tx, { user, companyId }) =>
      loans.cancelLoan(tx, {
        companyId,
        id,
        reason: str(formData, "reason") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not cancel the loan.") };
  }
  revalidateLoan(id);
  return { success: true, id };
}

function revalidateLoan(id: string) {
  revalidatePath("/dashboard/hr/loans");
  revalidatePath(`/dashboard/hr/loans/${id}`);
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listLoansForPage(
  opts: { status?: string; employeeId?: string; search?: string; page?: number; limit?: number } = {},
) {
  const limit = opts.limit ?? 20;
  const page = Math.max(opts.page ?? 1, 1);

  return withAuthorizedTenant(REQUEST_ROLES, async (tx) => {
    const [{ rows, total }, stats] = await Promise.all([
      loans.listLoans(tx, {
        status: opts.status || null,
        employeeId: opts.employeeId || null,
        search: opts.search,
        limit,
        offset: (page - 1) * limit,
      }),
      loans.getLoanStats(tx),
    ]);
    return {
      loans: rows,
      stats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  });
}

export async function getLoanForPage(id: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const loan = await loans.getLoan(tx, id);
    if (!loan) return null;

    // An employee may look at their own loan; everyone else needs a role.
    if (!roleAllowed(user.role, REQUEST_ROLES)) {
      const me = await employees.getEmployeeByUser(tx, user.id);
      if (!me || me.id !== loan.employeeId) return null;
    }

    return {
      loan,
      can: {
        approve: roleAllowed(user.role, APPROVE_ROLES),
        disburse: roleAllowed(user.role, DISBURSE_ROLES),
      },
    };
  });
}

/** Loans awaiting approval — the count and the list, for the approvals dashboard. */
export async function countLoansAwaitingApproval() {
  try {
    const { pending } = await withAuthorizedTenant(REQUEST_ROLES, (tx) =>
      loans.getLoanStats(tx),
    );
    return pending;
  } catch {
    return 0;
  }
}

export async function listLoansAwaitingApproval(limit = 5) {
  try {
    const { rows } = await withAuthorizedTenant(REQUEST_ROLES, (tx) =>
      loans.listLoans(tx, { status: "pending_approval", limit }),
    );
    return rows.map((l) => ({
      _id: l.id,
      ref: l.loanNumber,
      title: l.employeeName,
      subtitle: l.loanType.replace(/_/g, " "),
      submittedAt: l.requestedAt,
      submittedBy: l.employeeName,
      amount: l.principalAmount,
      href: `/dashboard/hr/loans/${l.id}`,
      meta: `${l.tenureMonths} months`,
    }));
  } catch {
    return [];
  }
}

export async function getLoanFormData() {
  return withAuthorizedTenant(REQUEST_ROLES, async (tx) => {
    const [staff, postable] = await Promise.all([
      employees.listEmployeesForPicker(tx, { limit: 50 }),
      accounts.listPaymentAccounts(tx),
    ]);
    return { employees: staff, paymentAccounts: postable };
  });
}

export async function searchLoanEmployees(search: string) {
  return withAuthorizedTenant(REQUEST_ROLES, (tx) =>
    employees.listEmployeesForPicker(tx, { search }),
  );
}
