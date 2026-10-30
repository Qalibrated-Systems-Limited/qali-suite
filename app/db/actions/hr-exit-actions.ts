"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { roleAllowed } from "@/lib/permissions";
import { userMessage } from "../errors";
import { deactivateUser } from "../userAdmin";
import * as exits from "../repositories/exits";
import { rolesFor } from "@/lib/capabilities";

/**
 * Employee exits: HR prepares the case and the clearance; finance approves the
 * final dues (they post to the ledger) and records the payment.
 */

const MANAGE_ROLES = rolesFor("exit.manage");
const APPROVE_ROLES = rolesFor("exit.approve");
const PAY_ROLES = rolesFor("exit.pay");
const VIEW_ROLES = [...new Set([...MANAGE_ROLES, ...APPROVE_ROLES, ...PAY_ROLES])];

export type ActionResult =
  | { success: true; id?: string; message?: string; warning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const optNum = (fd: FormData, key: string) => {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

function exitInput(fd: FormData): exits.ExitInput {
  return {
    exitType: str(fd, "exitType"),
    noticeDate: str(fd, "noticeDate") || null,
    lastWorkingDate: str(fd, "lastWorkingDate"),
    noticePeriodDays: optNum(fd, "noticePeriodDays"),
    recoverNoticeShortfall: str(fd, "recoverNoticeShortfall") === "on" || str(fd, "recoverNoticeShortfall") === "true",
    dailyRate: optNum(fd, "dailyRate"),
    leaveDaysOverride: optNum(fd, "leaveDaysOverride"),
    reason: str(fd, "reason") || null,
    exitInterviewNotes: str(fd, "exitInterviewNotes") || null,
  };
}

function revalidateExit(id: string, employeeId?: string) {
  revalidatePath("/dashboard/hr/exits");
  revalidatePath(`/dashboard/hr/exits/${id}`);
  if (employeeId) revalidatePath(`/dashboard/hr/employees/${employeeId}`);
}

export async function createExit(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const employeeId = str(formData, "employeeId");
  const input = exitInput(formData);
  const fieldErrors: Record<string, string> = {};
  if (!employeeId) fieldErrors.employeeId = "Choose an employee";
  if (!input.exitType) fieldErrors.exitType = "Choose how the employment is ending";
  if (!input.lastWorkingDate) fieldErrors.lastWorkingDate = "Enter the last working day";
  if (Object.keys(fieldErrors).length) {
    return { success: false, error: "Please fill in all required fields", fieldErrors };
  }

  let id: string;
  try {
    const exit = await withAuthorizedTenant(MANAGE_ROLES, (tx, { user, companyId }) =>
      exits.createExit(tx, {
        ...input,
        companyId,
        employeeId,
        actor: { id: user.id, name: user.name },
      }),
    );
    id = exit.id;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not start the exit.") };
  }
  revalidateExit(id, employeeId);
  redirect(`/dashboard/hr/exits/${id}`);
}

export async function updateExit(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "exitId");
  if (!id) return { success: false, error: "Exit ID is required" };
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user }) =>
      exits.updateExit(tx, { ...exitInput(formData), id, actor: { id: user.id, name: user.name } }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the exit.") };
  }
  revalidateExit(id);
  return { success: true, id, message: "Saved. The final dues have been recalculated." };
}

export async function addExitLine(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const exitId = str(formData, "exitId");
  const kind = str(formData, "kind") === "deduction" ? "deduction" : "earning";
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx, { companyId }) =>
      exits.addManualLine(tx, {
        companyId,
        exitId,
        kind,
        description: str(formData, "description"),
        amount: Number(str(formData, "amount")),
        accountId: str(formData, "accountId") || null,
        // Earnings are pay unless marked otherwise; deductions come off net.
        taxable: kind === "earning" ? str(formData, "notTaxable") !== "on" : false,
        pensionable: kind === "earning" ? str(formData, "notPensionable") !== "on" : false,
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not add the line.") };
  }
  revalidateExit(exitId);
  return { success: true, id: exitId };
}

export async function removeExitLine(exitId: string, lineId: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx) => exits.removeManualLine(tx, lineId));
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not remove the line.") };
  }
  revalidateExit(exitId);
  return { success: true, id: exitId };
}

export async function addClearanceItem(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const exitId = str(formData, "exitId");
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx, { companyId }) =>
      exits.addClearanceItem(tx, {
        companyId,
        exitId,
        area: str(formData, "area"),
        item: str(formData, "item"),
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not add the item.") };
  }
  revalidateExit(exitId);
  return { success: true, id: exitId };
}

export async function setClearanceStatus(
  exitId: string,
  itemId: string,
  status: "pending" | "cleared" | "waived",
  note?: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user }) =>
      exits.setClearanceStatus(tx, {
        itemId,
        status,
        note: note ?? null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not update the item.") };
  }
  revalidateExit(exitId);
  return { success: true, id: exitId };
}

export async function removeClearanceItem(exitId: string, itemId: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx) => exits.removeClearanceItem(tx, itemId));
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not remove the item.") };
  }
  revalidateExit(exitId);
  return { success: true, id: exitId };
}

export async function approveExit(id: string): Promise<ActionResult> {
  let userId: string | null = null;
  let employeeId: string | undefined;
  let message: string;
  try {
    const done = await withAuthorizedTenant(APPROVE_ROLES, (tx, { user, companyId }) =>
      exits.approveExit(tx, { companyId, id, actor: { id: user.id, name: user.name } }),
    );
    userId = done.userId;
    employeeId = done.exit.employeeId;
    message =
      done.exit.status === "paid"
        ? "Approved. The net was nil, so the exit is settled."
        : "Approved and posted. Record the payment once the money is released.";
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not approve the final dues.") };
  }

  let warning: string | undefined;
  if (userId) {
    try {
      await deactivateUser(userId);
    } catch (err) {
      console.error("Could not deactivate the leaver's login:", err);
      warning =
        "The exit was approved, but the employee's login could not be deactivated. Deactivate it under Settings → Users.";
    }
  }

  revalidateExit(id, employeeId);
  revalidatePath("/dashboard/hr/employees");
  revalidatePath("/dashboard/journal");
  revalidatePath("/dashboard/hr/loans");
  return { success: true, id, message, ...(warning ? { warning } : {}) };
}

export async function payExit(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "exitId");
  try {
    await withAuthorizedTenant(PAY_ROLES, (tx, { user, companyId }) =>
      exits.payExit(tx, {
        companyId,
        id,
        paymentReference: str(formData, "paymentReference") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record the payment.") };
  }
  revalidateExit(id);
  revalidatePath("/dashboard/journal");
  return { success: true, id, message: "Payment recorded." };
}

export async function cancelExit(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "exitId");
  const reason = str(formData, "reason");
  if (!reason) {
    return { success: false, error: "Say why the exit is being cancelled", fieldErrors: { reason: "Required" } };
  }
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user }) =>
      exits.cancelExit(tx, { id, reason, actor: { id: user.id, name: user.name } }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not cancel the exit.") };
  }
  revalidateExit(id);
  return { success: true, id, message: "Exit cancelled." };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listExitsForPage(
  opts: { status?: string; search?: string; page?: number; limit?: number } = {},
) {
  const limit = opts.limit ?? 20;
  const page = Math.max(opts.page ?? 1, 1);
  return withAuthorizedTenant(VIEW_ROLES, async (tx, { user }) => {
    const { rows, total } = await exits.listExits(tx, {
      status: opts.status || null,
      search: opts.search,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      exits: rows,
      can: { manage: roleAllowed(user.role, MANAGE_ROLES) },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  });
}

export async function getExitForPage(id: string) {
  return withAuthorizedTenant(VIEW_ROLES, async (tx, { user }) => {
    const data = await exits.getExit(tx, id);
    if (!data) return null;
    return {
      ...data,
      can: {
        manage: roleAllowed(user.role, MANAGE_ROLES),
        approve: roleAllowed(user.role, APPROVE_ROLES),
        pay: roleAllowed(user.role, PAY_ROLES),
      },
    };
  });
}

/** The live exit for an employee, if any — for the employee page. */
export async function getEmployeeExit(employeeId: string) {
  try {
    return await withAuthorizedTenant(VIEW_ROLES, async (tx, { user }) => ({
      exit: await exits.getExitForEmployee(tx, employeeId),
      canManage: roleAllowed(user.role, MANAGE_ROLES),
    }));
  } catch {
    return { exit: null, canManage: false };
  }
}

export async function getCertificateOfService(employeeId: string) {
  return withAuthorizedTenant(VIEW_ROLES, (tx) =>
    exits.getCertificateOfServiceData(tx, employeeId),
  );
}

export async function getExitFormData() {
  return withAuthorizedTenant(MANAGE_ROLES, async (tx) => ({
    employees: await exits.listEmployeesForExit(tx),
  }));
}

export async function listExitPostingAccounts() {
  return withAuthorizedTenant(MANAGE_ROLES, (tx) => exits.listPostingAccounts(tx));
}
