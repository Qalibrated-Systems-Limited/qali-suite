"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { roleAllowed } from "@/lib/permissions";
import {
  HR_VIEW_ROLES,
  HR_ADMIN_ROLES,
} from "@/lib/utils/role-gates";
import { userMessage } from "../errors";
import * as leave from "../repositories/leave";
import * as employees from "../repositories/employees";

/**
 * Postgres-backed leave actions.
 *
 * WHO MAY DO WHAT is decided here, and there are only two rules:
 *
 *   - anybody signed in may act on THEIR OWN leave;
 *   - approving, rejecting, cancelling and anything touching entitlements is
 *     for approvers.
 *
 * The source spreads the first rule across four actions with three different
 * spellings, and one of them reads the employee profile with no tenant scope
 * at all.
 */

export type ActionResult =
  | { success: true; id?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const APPROVE_ROLES = ["SuperAdmin", "Admin", "Manager", "HR Manager"];

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (fd: FormData, key: string) => str(fd, key) || null;

/** The employee record belonging to the signed-in user, if there is one. */
async function ownEmployeeId(tx: Parameters<typeof leave.getLeaveRequest>[0], userId: string) {
  const me = await employees.getEmployeeByUser(tx, userId);
  return me?.id ?? null;
}

export async function createLeaveRequest(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const employeeId = str(formData, "employeeId");
  const leaveTypeId = str(formData, "leaveTypeId");
  const fromDate = str(formData, "fromDate");
  const toDate = str(formData, "toDate");

  const fieldErrors: Record<string, string> = {};
  if (!employeeId) fieldErrors.employeeId = "Choose an employee";
  if (!leaveTypeId) fieldErrors.leaveTypeId = "Choose a leave type";
  if (!fromDate) fieldErrors.fromDate = "Required";
  if (!toDate) fieldErrors.toDate = "Required";
  if (Object.keys(fieldErrors).length) {
    return { success: false, error: "Please fill in all required fields", fieldErrors };
  }

  let id: string;
  try {
    const created = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      // Anybody may request their own leave; only an approver may raise one
      // for somebody else.
      if (!roleAllowed(user.role, APPROVE_ROLES)) {
        const mine = await ownEmployeeId(tx, user.id);
        if (mine !== employeeId) {
          throw new Error("You can only request leave for yourself.");
        }
      }

      return leave.createLeaveRequest(tx, {
        companyId,
        employeeId,
        leaveTypeId,
        fromDate,
        toDate,
        isHalfDay: formData.get("halfDay") === "true",
        halfDayPeriod: orNull(formData, "halfDayPeriod"),
        reason: orNull(formData, "reason"),
        handoverEmployeeId: orNull(formData, "handoverEmployeeId"),
        handoverNotes: orNull(formData, "handoverNotes"),
        submit: formData.get("submitNow") === "true",
        actor: { id: user.id, name: user.name },
      });
    });
    id = created.id;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not create the leave request.") };
  }

  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/hr/my-leave");
  redirect(`/dashboard/hr/leave/${id}`);
}

/** Draft → submitted. The employee's own, or an approver acting for them. */
export async function submitLeaveRequest(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      await assertOwnOrApprover(tx, id, user);
      return leave.submitLeaveRequest(tx, {
        id,
        actor: { id: user.id, name: user.name },
      });
    });
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not submit the request.") };
  }
  revalidateLeave(id);
  return { success: true, id };
}

export async function approveLeaveRequest(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(APPROVE_ROLES, (tx, { user }) =>
      leave.approveLeaveRequest(tx, {
        id,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not approve the request.") };
  }
  revalidateLeave(id);
  return { success: true, id };
}

export async function rejectLeaveRequest(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "leaveId");
  const reason = str(formData, "reason");
  if (!id) return { success: false, error: "Leave request ID is required" };
  if (!reason) {
    return {
      success: false,
      error: "A rejection needs a reason",
      fieldErrors: { reason: "Required" },
    };
  }

  try {
    await withAuthorizedTenant(APPROVE_ROLES, (tx, { user }) =>
      leave.rejectLeaveRequest(tx, {
        id,
        reason,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not reject the request.") };
  }
  revalidateLeave(id);
  return { success: true, id };
}

export async function recallLeaveRequest(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      await assertOwnOrApprover(tx, id, user);
      return leave.recallLeaveRequest(tx, {
        id,
        actor: { id: user.id, name: user.name },
      });
    });
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not recall the request.") };
  }
  revalidateLeave(id);
  return { success: true, id, message: "Pulled back to draft — edit it and send it again." };
}

export async function cancelLeaveRequest(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "leaveId");
  if (!id) return { success: false, error: "Leave request ID is required" };

  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx, { user }) =>
      leave.cancelLeaveRequest(tx, {
        id,
        reason: orNull(formData, "reason"),
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not cancel the leave.") };
  }
  revalidateLeave(id);
  return { success: true, id };
}

async function assertOwnOrApprover(
  tx: Parameters<typeof leave.getLeaveRequest>[0],
  id: string,
  user: { id: string; role: string },
) {
  if (roleAllowed(user.role, APPROVE_ROLES)) return;
  const request = await leave.getLeaveRequest(tx, id);
  if (!request) throw new Error("Leave request not found");
  if (request.employeeUserId !== user.id) {
    throw new Error("You can only act on your own leave requests.");
  }
}

function revalidateLeave(id: string) {
  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/hr/my-leave");
  revalidatePath(`/dashboard/hr/leave/${id}`);
}

// ── Leave types ──────────────────────────────────────────────────────────────

export async function saveLeaveType(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "leaveTypeId");
  const name = str(formData, "name");
  if (!name) {
    return { success: false, error: "Name is required", fieldErrors: { name: "Required" } };
  }

  const isPaid = formData.get("isPaid") === "true";
  const payload = {
    name,
    description: orNull(formData, "description"),
    defaultEntitlement: Number(str(formData, "defaultEntitlement") || 0),
    maxCarryOver: Number(str(formData, "maxCarryOver") || 0),
    isPaid,
    // Defaults to following isPaid, which is what makes the source's
    // `code !== "unpaid"` special case unnecessary.
    affectsBalance: formData.has("affectsBalance")
      ? formData.get("affectsBalance") === "true"
      : isPaid,
    requiresDocument: formData.get("requiresDocument") === "true",
    applicableGender: str(formData, "applicableGender") || "all",
    sortOrder: Number(str(formData, "sortOrder") || 0),
    // The form has always had this switch; the action never read it, so a
    // leave type could be deactivated in the dialog and come back active.
    ...(formData.has("isActive")
      ? { isActive: formData.get("isActive") === "true" }
      : {}),
  };

  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx, { user, companyId }) =>
      id
        ? leave.updateLeaveType(tx, { id, ...payload })
        : leave.createLeaveType(tx, {
            companyId,
            code: str(formData, "code"),
            ...payload,
            actor: { id: user.id, name: user.name },
          }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the leave type.") };
  }

  revalidatePath("/dashboard/hr/leave-types");
  return { success: true };
}

export async function setLeaveTypeActive(id: string, isActive: boolean) {
  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx) =>
      leave.updateLeaveType(tx, { id, isActive }),
    );
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not update the leave type.") };
  }
  revalidatePath("/dashboard/hr/leave-types");
  return { success: true as const };
}

export async function deleteLeaveType(id: string) {
  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx) => leave.deleteLeaveType(tx, id));
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not delete the leave type.") };
  }
  revalidatePath("/dashboard/hr/leave-types");
  return { success: true as const };
}

export async function seedLeaveTypes() {
  try {
    const result = await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx, { companyId }) =>
      leave.seedLeaveTypes(tx, companyId),
    );
    revalidatePath("/dashboard/hr/leave-types");
    return { success: true as const, ...result };
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not add the standard leave types.") };
  }
}

// ── Entitlements and the year end ────────────────────────────────────────────

export async function setEntitlement(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const employeeId = str(formData, "employeeId");
  const leaveTypeId = str(formData, "leaveTypeId");
  const year = Number(str(formData, "year") || new Date().getFullYear());
  if (!employeeId || !leaveTypeId) {
    return { success: false, error: "Employee and leave type are required" };
  }

  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx, { companyId }) =>
      leave.setEntitlement(tx, {
        companyId,
        employeeId,
        leaveTypeId,
        year,
        entitledDays: Number(str(formData, "entitledDays") || 0),
        carryOverDays: Number(str(formData, "carryOverDays") || 0),
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the entitlement.") };
  }

  revalidatePath(`/dashboard/hr/employees/${employeeId}/leave-balances`);
  revalidatePath(`/dashboard/hr/employees/${employeeId}`);
  return { success: true, id: employeeId };
}

export async function grantYearEntitlements(employeeId: string, year: number) {
  try {
    const result = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      async (tx, { companyId }) => {
        const employee = await employees.getEmployee(tx, employeeId);
        if (!employee) throw new Error("Employee not found");
        return leave.grantYearEntitlements(tx, {
          companyId,
          employeeId,
          year,
          gender: employee.gender,
        });
      },
    );
    revalidatePath(`/dashboard/hr/employees/${employeeId}/leave-balances`);
    return { success: true as const, ...result };
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not grant the entitlement.") };
  }
}

export async function runCarryOver(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const fromYear = Number(str(formData, "fromYear"));
  const toYear = Number(str(formData, "toYear"));
  if (!fromYear || !toYear || toYear <= fromYear) {
    return { success: false, error: "Choose a year to carry from and the year after it." };
  }

  try {
    const { processed, totalCarried } = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      (tx, { companyId }) =>
        leave.runCarryOver(tx, {
          companyId,
          fromYear,
          toYear,
          leaveTypeId: orNull(formData, "leaveTypeId"),
        }),
    );
    revalidatePath("/dashboard/hr/leave/admin");
    return {
      success: true,
      message: `${totalCarried} day(s) carried into ${toYear} for ${processed} employee(s).`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "The carry-over could not be run.") };
  }
}

export async function runAccrual(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const year = Number(str(formData, "year"));
  const throughMonth = Number(str(formData, "throughMonth"));
  const leaveTypeId = str(formData, "leaveTypeId");
  const daysPerMonth = Number(str(formData, "daysPerMonth") || 1.75);

  if (!year || !throughMonth || !leaveTypeId) {
    return { success: false, error: "Year, month and leave type are required." };
  }

  try {
    const { processed } = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      (tx, { companyId }) =>
        leave.runAccrual(tx, { companyId, year, throughMonth, leaveTypeId, daysPerMonth }),
    );
    revalidatePath("/dashboard/hr/leave/admin");
    return {
      success: true,
      message: `${processed} employee(s) credited up to month ${throughMonth}. Running this again changes nothing.`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "The accrual could not be run.") };
  }
}

export async function encashLeave(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const employeeId = str(formData, "employeeId");
  const leaveTypeId = str(formData, "leaveTypeId");
  const year = Number(str(formData, "year") || new Date().getFullYear());
  const days = Number(str(formData, "days"));
  const dailyRate = Number(str(formData, "dailyRate"));

  if (!employeeId || !leaveTypeId || !days || !dailyRate) {
    return { success: false, error: "Employee, leave type, days and daily rate are required." };
  }

  try {
    const { amount } = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      (tx, { companyId }) =>
        leave.encashLeave(tx, { companyId, employeeId, leaveTypeId, year, days, dailyRate }),
    );
    revalidatePath(`/dashboard/hr/employees/${employeeId}/leave-balances`);
    return {
      success: true,
      message: `${days} day(s) encashed at ${dailyRate}/day — ${amount.toLocaleString()}. Add it to the payslip as a one-off earning.`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "The encashment could not be recorded.") };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The leave list.
 *
 * Finished leave is marked complete on the way in — the source does the same
 * from this page, which is the only trigger it has.
 */
export async function listLeaveForPage(
  opts: {
    status?: string;
    employeeId?: string;
    year?: number;
    search?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const limit = opts.limit ?? 20;
  const page = Math.max(opts.page ?? 1, 1);

  return withAuthorizedTenant([...HR_VIEW_ROLES], async (tx, { companyId }) => {
    await leave.completeFinishedLeave(tx, companyId);
    const { rows, total } = await leave.listLeaveRequests(tx, {
      status: opts.status || null,
      employeeId: opts.employeeId || null,
      year: opts.year || null,
      search: opts.search,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      requests: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  });
}

export async function getLeaveRequestForPage(id: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const request = await leave.getLeaveRequest(tx, id);
    if (!request) return null;
    // An employee may open their own; anybody who can see HR may open any.
    if (
      !roleAllowed(user.role, [...HR_VIEW_ROLES]) &&
      request.employeeUserId !== user.id
    ) {
      return null;
    }
    const balances = await leave.getLeaveBalances(
      tx,
      request.employeeId,
      Number(request.fromDate.slice(0, 4)),
    );
    return { request, balances, canApprove: roleAllowed(user.role, APPROVE_ROLES) };
  });
}

export async function getLeaveFormData(employeeId?: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const me = await employees.getEmployeeByUser(tx, user.id);
    const isApprover = roleAllowed(user.role, APPROVE_ROLES);

    const target = employeeId ?? me?.id ?? null;
    const [types, staffList, balances] = await Promise.all([
      leave.listLeaveTypes(tx, {
        activeOnly: true,
        // Maternity for men and paternity for women are not choices worth
        // offering; the source filters these only at hiring time.
        gender: target && !isApprover ? (me?.gender ?? null) : null,
      }),
      isApprover ? employees.listEmployeesForPicker(tx, { limit: 50 }) : [],
      target
        ? leave.getLeaveBalances(tx, target, new Date().getFullYear())
        : [],
    ]);

    return {
      leaveTypes: types,
      employees: staffList,
      balances,
      me: me ? { id: me.id, name: me.fullName, gender: me.gender } : null,
      isApprover,
    };
  });
}

export async function getMyLeave() {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const me = await employees.getEmployeeByUser(tx, user.id);
    if (!me) return { employee: null, requests: [], balances: [] };

    await leave.completeFinishedLeave(tx, companyId);
    const [requests, balances] = await Promise.all([
      leave.listLeaveRequests(tx, { employeeId: me.id, limit: 50 }),
      leave.getLeaveBalances(tx, me.id, new Date().getFullYear()),
    ]);
    return {
      employee: { id: me.id, name: me.fullName, employeeNumber: me.employeeNumber },
      requests: requests.rows,
      balances,
    };
  });
}

export async function getLeaveCalendarForPage(month: number, year: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  return withAuthorizedTenant([...HR_VIEW_ROLES], async (tx, { companyId }) => {
    // The last day of the month, from the database — `new Date(y, m, 0)` then
    // formatted in UTC is the day before, east of Greenwich.
    const [{ last_day }] = (await tx.execute(
      sql`SELECT (date_trunc('month', ${from}::date) + interval '1 month - 1 day')::date AS last_day`,
    )) as unknown as Array<{ last_day: string }>;
    const to = String(last_day).slice(0, 10);

    const [events, holidays] = await Promise.all([
      leave.getLeaveCalendar(tx, from, to),
      leave.getHolidays(tx, companyId, from, to),
    ]);
    return { from, to, events, holidays };
  });
}

export async function listLeaveTypesForPage() {
  return withAuthorizedTenant([...HR_VIEW_ROLES], (tx) =>
    leave.listLeaveTypes(tx, { activeOnly: false }),
  );
}

export async function getEmployeeLeaveBalances(employeeId: string, year?: number) {
  return withAuthorizedTenant([...HR_VIEW_ROLES], async (tx) => {
    const [employee, balances, types] = await Promise.all([
      employees.getEmployee(tx, employeeId),
      leave.getLeaveBalances(tx, employeeId, year ?? new Date().getFullYear()),
      leave.listLeaveTypes(tx, { activeOnly: true }),
    ]);
    return { employee, balances, leaveTypes: types };
  });
}
