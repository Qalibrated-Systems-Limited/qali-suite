import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { leaveTypes, leaveEntitlements, leaveRequests } from "../schema";

/**
 * Leave.
 *
 * The balance is not stored. `leave_entitlements` holds what was granted and
 * the `leave_balances` view counts the rest off `leave_requests` — see
 * migration 0046 for why the source's four $inc counters could not stay right.
 *
 * So none of the transitions below touch a balance. Approving a request
 * changes its status; the days taken follow from that, immediately and
 * exactly, with nothing to keep in step.
 */

const trimmed = (v: unknown) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

/** Kenya's usual set. Seeded per tenant, once. */
const DEFAULT_LEAVE_TYPES = [
  { code: "annual", name: "Annual Leave", defaultEntitlement: "21", maxCarryOver: "5", isPaid: true, affectsBalance: true, requiresDocument: false, applicableGender: "all", sortOrder: 0 },
  { code: "sick", name: "Sick Leave", defaultEntitlement: "30", maxCarryOver: "0", isPaid: true, affectsBalance: true, requiresDocument: true, applicableGender: "all", sortOrder: 1 },
  { code: "maternity", name: "Maternity Leave", defaultEntitlement: "90", maxCarryOver: "0", isPaid: true, affectsBalance: true, requiresDocument: true, applicableGender: "female", sortOrder: 2 },
  { code: "paternity", name: "Paternity Leave", defaultEntitlement: "14", maxCarryOver: "0", isPaid: true, affectsBalance: true, requiresDocument: false, applicableGender: "male", sortOrder: 3 },
  { code: "compassionate", name: "Compassionate Leave", defaultEntitlement: "5", maxCarryOver: "0", isPaid: true, affectsBalance: true, requiresDocument: false, applicableGender: "all", sortOrder: 4 },
  // Unpaid leave consumes no entitlement — which is a property of the type,
  // not the string "unpaid" tested at five call sites.
  { code: "unpaid", name: "Leave Without Pay", defaultEntitlement: "0", maxCarryOver: "0", isPaid: false, affectsBalance: false, requiresDocument: false, applicableGender: "all", sortOrder: 5 },
] as const;

export async function seedLeaveTypes(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT COUNT(*)::int AS n FROM leave_types`,
  )) as unknown as Array<{ n: number }>;
  if (Number(n) > 0) return { seeded: 0 };

  await tx.insert(leaveTypes).values(
    DEFAULT_LEAVE_TYPES.map((t) => ({
      companyId,
      code: t.code,
      name: t.name,
      defaultEntitlement: t.defaultEntitlement,
      maxCarryOver: t.maxCarryOver,
      isPaid: t.isPaid,
      affectsBalance: t.affectsBalance,
      requiresDocument: t.requiresDocument,
      applicableGender: t.applicableGender,
      sortOrder: t.sortOrder,
      isDefault: true,
    })),
  );
  return { seeded: DEFAULT_LEAVE_TYPES.length };
}

export async function listLeaveTypes(
  tx: Tx,
  opts: { activeOnly?: boolean; gender?: string | null } = {},
) {
  const filters = [sql`TRUE`];
  if (opts.activeOnly !== false) filters.push(sql`is_active`);
  if (opts.gender) {
    filters.push(sql`(applicable_gender = 'all' OR applicable_gender = ${opts.gender})`);
  }

  const rows = (await tx.execute(sql`
    SELECT id, code, name, description, default_entitlement, max_carry_over,
           is_paid, affects_balance, requires_document, applicable_gender,
           is_active, is_default, sort_order
      FROM leave_types
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY sort_order, name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    description: (r.description as string) ?? null,
    defaultEntitlement: Number(r.default_entitlement),
    maxCarryOver: Number(r.max_carry_over),
    isPaid: Boolean(r.is_paid),
    affectsBalance: Boolean(r.affects_balance),
    requiresDocument: Boolean(r.requires_document),
    applicableGender: String(r.applicable_gender),
    isActive: Boolean(r.is_active),
    isDefault: Boolean(r.is_default),
    sortOrder: Number(r.sort_order),
  }));
}

export interface LeaveTypeInput {
  companyId: string;
  code?: string;
  name: string;
  description?: string | null;
  defaultEntitlement?: number | string;
  maxCarryOver?: number | string;
  isPaid?: boolean;
  affectsBalance?: boolean;
  requiresDocument?: boolean;
  applicableGender?: string;
  sortOrder?: number;
  actor?: { id?: string | null; name?: string | null };
}

const days = (v: unknown, fallback = "0") => {
  const n = Number(v ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : fallback;
};

export async function createLeaveType(tx: Tx, input: LeaveTypeInput) {
  const name = trimmed(input.name);
  if (!name) throw new Error("Leave type name is required");

  const code =
    trimmed(input.code)?.toLowerCase().replace(/\s+/g, "_") ??
    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const [created] = await tx
    .insert(leaveTypes)
    .values({
      companyId: input.companyId,
      code,
      name,
      description: trimmed(input.description),
      defaultEntitlement: days(input.defaultEntitlement),
      maxCarryOver: days(input.maxCarryOver),
      isPaid: input.isPaid ?? true,
      // Unpaid leave consumes nothing by default, which is what makes the
      // "unpaid" special case unnecessary.
      affectsBalance: input.affectsBalance ?? (input.isPaid ?? true),
      requiresDocument: input.requiresDocument ?? false,
      applicableGender: input.applicableGender ?? "all",
      sortOrder: input.sortOrder ?? 0,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .returning();

  return created;
}

export async function updateLeaveType(
  tx: Tx,
  input: Partial<LeaveTypeInput> & { id: string; isActive?: boolean },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = trimmed(input.name);
    if (!name) throw new Error("Leave type name is required");
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = trimmed(input.description);
  if (input.defaultEntitlement !== undefined) {
    patch.defaultEntitlement = days(input.defaultEntitlement);
  }
  if (input.maxCarryOver !== undefined) patch.maxCarryOver = days(input.maxCarryOver);
  if (input.isPaid !== undefined) patch.isPaid = input.isPaid;
  if (input.affectsBalance !== undefined) patch.affectsBalance = input.affectsBalance;
  if (input.requiresDocument !== undefined) {
    patch.requiresDocument = input.requiresDocument;
  }
  if (input.applicableGender !== undefined) {
    patch.applicableGender = input.applicableGender;
  }
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  const [updated] = await tx
    .update(leaveTypes)
    .set(patch)
    .where(eq(leaveTypes.id, input.id))
    .returning();
  if (!updated) throw new Error("Leave type not found");
  return updated;
}

/**
 * Removes a leave type.
 *
 * Refused when anything references it — the foreign keys would refuse anyway,
 * and this way the message says which.
 */
export async function deleteLeaveType(tx: Tx, id: string) {
  const [row] = (await tx.execute(sql`
    SELECT lt.is_default,
           (SELECT COUNT(*) FROM leave_requests     WHERE leave_type_id = lt.id)::int AS requests,
           (SELECT COUNT(*) FROM leave_entitlements WHERE leave_type_id = lt.id)::int AS grants
      FROM leave_types lt
     WHERE lt.id = ${id}::uuid
  `)) as unknown as Array<{ is_default: boolean; requests: number; grants: number }>;

  if (!row) throw new Error("Leave type not found");
  if (row.is_default) {
    throw new Error(
      "This is a standard leave type and cannot be deleted. Deactivate it instead.",
    );
  }
  if (Number(row.requests) > 0) {
    throw new Error(
      `${row.requests} leave request(s) use this type. Deactivate it instead — deleting would erase their history.`,
    );
  }
  if (Number(row.grants) > 0) {
    throw new Error(
      "Employees have an entitlement of this type. Deactivate it instead.",
    );
  }

  await tx.delete(leaveTypes).where(eq(leaveTypes.id, id));
  return { deleted: true };
}

// ── Entitlements ─────────────────────────────────────────────────────────────

/**
 * Grants an employee the year's leave, one row per applicable type.
 *
 * Called when somebody is hired and again at the turn of the year. Idempotent:
 * a type already granted for that year is left alone rather than reset, so
 * re-running does not wipe an entitlement HR has adjusted by hand.
 */
export async function grantYearEntitlements(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    year: number;
    gender?: string | null;
  },
) {
  const types = await listLeaveTypes(tx, {
    activeOnly: true,
    gender: input.gender ?? null,
  });

  let granted = 0;
  for (const t of types) {
    if (!t.affectsBalance) continue;
    const result = (await tx.execute(sql`
      INSERT INTO leave_entitlements
        (company_id, employee_id, leave_type_id, year, entitled_days)
      VALUES (${input.companyId}::uuid, ${input.employeeId}::uuid,
              ${t.id}::uuid, ${input.year}, ${t.defaultEntitlement})
      ON CONFLICT (company_id, employee_id, leave_type_id, year) DO NOTHING
      RETURNING id
    `)) as unknown as Array<unknown>;
    if (result.length) granted++;
  }
  return { granted };
}

export async function setEntitlement(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    leaveTypeId: string;
    year: number;
    entitledDays: number | string;
    carryOverDays?: number | string;
  },
) {
  const [row] = (await tx.execute(sql`
    INSERT INTO leave_entitlements
      (company_id, employee_id, leave_type_id, year, entitled_days, carry_over_days)
    VALUES (${input.companyId}::uuid, ${input.employeeId}::uuid,
            ${input.leaveTypeId}::uuid, ${input.year},
            ${days(input.entitledDays)}, ${days(input.carryOverDays)})
    ON CONFLICT (company_id, employee_id, leave_type_id, year)
    DO UPDATE SET entitled_days = EXCLUDED.entitled_days,
                  carry_over_days = EXCLUDED.carry_over_days,
                  updated_at = now()
    RETURNING id, entitled_days, carry_over_days
  `)) as unknown as Array<Record<string, unknown>>;
  return row;
}

/** The balance sheet for one employee: every type, for a year. */
export async function getLeaveBalances(
  tx: Tx,
  employeeId: string,
  year: number,
) {
  const rows = (await tx.execute(sql`
    SELECT lt.id AS leave_type_id, lt.code, lt.name, lt.is_paid, lt.affects_balance,
           COALESCE(b.entitled_days, 0)   AS entitled_days,
           COALESCE(b.carry_over_days, 0) AS carry_over_days,
           COALESCE(b.encashed_days, 0)   AS encashed_days,
           COALESCE(b.taken_days, 0)      AS taken_days,
           COALESCE(b.pending_days, 0)    AS pending_days,
           COALESCE(b.balance_days, 0)    AS balance_days,
           COALESCE(b.available_days, 0)  AS available_days
      FROM leave_types lt
      LEFT JOIN leave_balances b
             ON b.leave_type_id = lt.id
            AND b.employee_id = ${employeeId}::uuid
            AND b.year = ${year}
     WHERE lt.is_active
     ORDER BY lt.sort_order, lt.name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    leaveTypeId: String(r.leave_type_id),
    code: String(r.code),
    name: String(r.name),
    isPaid: Boolean(r.is_paid),
    affectsBalance: Boolean(r.affects_balance),
    entitledDays: Number(r.entitled_days),
    carryOverDays: Number(r.carry_over_days),
    encashedDays: Number(r.encashed_days),
    takenDays: Number(r.taken_days),
    pendingDays: Number(r.pending_days),
    balanceDays: Number(r.balance_days),
    availableDays: Number(r.available_days),
    year,
  }));
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** LV-2026-00001 — a counter per year, so numbers restart cleanly. */
async function nextLeaveNumber(tx: Tx, companyId: string, year: number) {
  const rows = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${"LV-" + year}) AS number`,
  )) as unknown as Array<{ number: string }>;
  return rows[0].number;
}

/** Working days in a span, counted by the database (0045). */
export async function countWorkingDays(
  tx: Tx,
  companyId: string,
  from: string,
  to: string,
): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT working_days(${companyId}::uuid, ${from}::date, ${to}::date) AS n`,
  )) as unknown as Array<{ n: number }>;
  return Number(row.n);
}

export interface CreateLeaveInput {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  reason?: string | null;
  handoverEmployeeId?: string | null;
  handoverNotes?: string | null;
  /** Submit straight away rather than saving a draft. */
  submit?: boolean;
  actor?: { id?: string | null; name?: string | null };
}

export async function createLeaveRequest(tx: Tx, input: CreateLeaveInput) {
  if (!input.fromDate || !input.toDate) {
    throw new Error("Both dates are required");
  }
  if (input.toDate < input.fromDate) {
    throw new Error("The end date cannot fall before the start date");
  }

  const [type] = (await tx.execute(sql`
    SELECT id, code, name, affects_balance, requires_document, applicable_gender
      FROM leave_types WHERE id = ${input.leaveTypeId}::uuid AND is_active
  `)) as unknown as Array<Record<string, unknown>>;
  if (!type) throw new Error("That leave type is not available");

  const isHalfDay = Boolean(input.isHalfDay);
  if (isHalfDay && input.fromDate !== input.toDate) {
    throw new Error("A half day is a single day. Choose one date, or clear the half-day option.");
  }

  const totalDays = isHalfDay
    ? 0.5
    : await countWorkingDays(tx, input.companyId, input.fromDate, input.toDate);

  if (totalDays === 0) {
    throw new Error(
      "That period contains no working days — it is all weekends or public holidays.",
    );
  }

  // Only a type that consumes an entitlement is checked against one. The
  // source asks `leaveType !== "unpaid"` here and in four other places.
  if (type.affects_balance) {
    const year = Number(input.fromDate.slice(0, 4));
    const [balance] = (await tx.execute(sql`
      SELECT available_days FROM leave_balances
       WHERE employee_id = ${input.employeeId}::uuid
         AND leave_type_id = ${input.leaveTypeId}::uuid
         AND year = ${year}
    `)) as unknown as Array<{ available_days: string }>;

    const available = Number(balance?.available_days ?? 0);
    if (totalDays > available) {
      throw new Error(
        `Not enough ${type.name} left: ${available} day(s) available, ${totalDays} requested.`,
      );
    }
  }

  const year = Number(input.fromDate.slice(0, 4));
  const leaveNumber = await nextLeaveNumber(tx, input.companyId, year);
  const submit = Boolean(input.submit);

  const [created] = await tx
    .insert(leaveRequests)
    .values({
      companyId: input.companyId,
      leaveNumber,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      totalDays: totalDays.toFixed(2),
      isHalfDay,
      halfDayPeriod: isHalfDay ? (trimmed(input.halfDayPeriod) ?? "morning") : null,
      reason: trimmed(input.reason),
      handoverEmployeeId: trimmed(input.handoverEmployeeId),
      handoverNotes: trimmed(input.handoverNotes),
      status: submit ? "submitted" : "draft",
      submittedAt: submit ? new Date() : null,
      submittedById: submit ? (input.actor?.id ?? null) : null,
      submittedByName: submit ? (input.actor?.name ?? null) : null,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name ?? null,
    })
    .returning();

  return created;
}

async function getRequestRow(tx: Tx, id: string) {
  const [row] = (await tx.execute(sql`
    SELECT r.*, e.user_id AS employee_user_id, lt.requires_document
      FROM leave_requests r
      JOIN employees e   ON e.id = r.employee_id
      JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

export async function submitLeaveRequest(
  tx: Tx,
  input: { id: string; actor?: { id?: string | null; name?: string | null } },
) {
  const row = await getRequestRow(tx, input.id);
  if (!row) throw new Error("Leave request not found");
  if (row.status !== "draft") {
    throw new Error("Only a draft request can be submitted.");
  }

  const [updated] = await tx
    .update(leaveRequests)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedById: input.actor?.id ?? null,
      submittedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leaveRequests.id, input.id))
    .returning();

  return updated;
}

export async function approveLeaveRequest(
  tx: Tx,
  input: { id: string; actor: { id: string; name: string } },
) {
  const row = await getRequestRow(tx, input.id);
  if (!row) throw new Error("Leave request not found");
  if (row.status !== "submitted") {
    throw new Error("Only a submitted request can be approved.");
  }

  // Segregation of duties: nobody signs off their own leave, whatever their
  // role. Carried over from the source deliberately.
  if (row.employee_user_id && String(row.employee_user_id) === input.actor.id) {
    throw new Error(
      "You can't approve your own leave request — ask another approver (HR, a manager, or an admin).",
    );
  }

  const [updated] = await tx
    .update(leaveRequests)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedById: input.actor.id,
      approvedByName: input.actor.name,
      updatedAt: new Date(),
    })
    .where(eq(leaveRequests.id, input.id))
    .returning();

  return updated;
}

export async function rejectLeaveRequest(
  tx: Tx,
  input: { id: string; reason: string; actor: { id: string; name: string } },
) {
  const reason = trimmed(input.reason);
  if (!reason) throw new Error("A rejection needs a reason.");

  const row = await getRequestRow(tx, input.id);
  if (!row) throw new Error("Leave request not found");
  if (row.status !== "submitted") {
    throw new Error("Only a submitted request can be rejected.");
  }
  if (row.employee_user_id && String(row.employee_user_id) === input.actor.id) {
    throw new Error("You can't reject your own leave request — ask another approver.");
  }

  const [updated] = await tx
    .update(leaveRequests)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedById: input.actor.id,
      rejectedByName: input.actor.name,
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(leaveRequests.id, input.id))
    .returning();

  return updated;
}

/**
 * Pulls a submitted request back — to DRAFT, so it can be corrected and sent
 * again.
 *
 * The source sets the status to 'recalled' and nothing moves it on, while
 * submit() accepts only a draft. So recalling stranded the request: the days
 * were released and the employee could never resubmit. The recall is recorded
 * as a timestamp; the state it returns to is draft.
 */
export async function recallLeaveRequest(
  tx: Tx,
  input: { id: string; actor?: { id?: string | null; name?: string | null } },
) {
  const row = await getRequestRow(tx, input.id);
  if (!row) throw new Error("Leave request not found");
  if (row.status !== "submitted") {
    throw new Error("Only a submitted request can be recalled.");
  }

  const [updated] = await tx
    .update(leaveRequests)
    .set({
      status: "draft",
      recalledAt: new Date(),
      submittedAt: null,
      submittedById: null,
      submittedByName: null,
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leaveRequests.id, input.id))
    .returning();

  return updated;
}

/**
 * Cancels leave that was already approved.
 *
 * The source defines an ADMIN_CANCEL role list and a 'cancelled' status, and
 * implements no action for either — so approved leave that is not taken could
 * only be undone in the database. Cancelling releases the days, because the
 * balance is counted from live requests.
 */
export async function cancelLeaveRequest(
  tx: Tx,
  input: { id: string; reason?: string | null; actor: { id: string; name: string } },
) {
  const row = await getRequestRow(tx, input.id);
  if (!row) throw new Error("Leave request not found");
  if (!["approved", "submitted", "draft"].includes(String(row.status))) {
    throw new Error("Only a draft, submitted or approved request can be cancelled.");
  }
  if (String(row.status) === "approved" && String(row.to_date) < new Date().toISOString().slice(0, 10)) {
    throw new Error(
      "That leave has already been taken. Cancelling it would remove days the employee was actually away.",
    );
  }

  const [updated] = await tx
    .update(leaveRequests)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: input.actor.id,
      cancelledByName: input.actor.name,
      cancellationReason: trimmed(input.reason),
      updatedAt: new Date(),
    })
    .where(eq(leaveRequests.id, input.id))
    .returning();

  return updated;
}

/**
 * Approved leave whose end date has passed becomes completed.
 *
 * Set-based and idempotent, and the completion time is the request's own end
 * date rather than whenever this happened to run.
 */
export async function completeFinishedLeave(tx: Tx, companyId: string) {
  const [row] = (await tx.execute(
    sql`SELECT complete_finished_leave(${companyId}::uuid) AS n`,
  )) as unknown as Array<{ n: number }>;
  return { completed: Number(row.n) };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listLeaveRequests(
  tx: Tx,
  opts: {
    status?: string | null;
    employeeId?: string | null;
    leaveTypeId?: string | null;
    year?: number | null;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const filters = [sql`TRUE`];
  if (opts.status) filters.push(sql`r.status = ${opts.status}`);
  if (opts.employeeId) filters.push(sql`r.employee_id = ${opts.employeeId}::uuid`);
  if (opts.leaveTypeId) filters.push(sql`r.leave_type_id = ${opts.leaveTypeId}::uuid`);
  if (opts.year) filters.push(sql`EXTRACT(YEAR FROM r.from_date) = ${opts.year}`);
  if (opts.search?.trim()) {
    const like = `%${opts.search.trim()}%`;
    filters.push(sql`(e.full_name ILIKE ${like} OR r.leave_number ILIKE ${like})`);
  }

  const rows = (await tx.execute(sql`
    SELECT r.id, r.leave_number, r.status, r.from_date, r.to_date, r.total_days,
           r.is_half_day, r.half_day_period, r.reason, r.submitted_at,
           r.approved_at, r.rejected_at, r.rejection_reason,
           r.employee_id, e.full_name AS employee_name, e.employee_number,
           d.name AS department,
           r.leave_type_id, lt.name AS leave_type_name, lt.code AS leave_type_code,
           lt.is_paid,
           COUNT(*) OVER () AS total
      FROM leave_requests r
      JOIN employees e        ON e.id = r.employee_id
      JOIN leave_types lt     ON lt.id = r.leave_type_id
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY r.from_date DESC, r.created_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    rows: rows.map(mapLeaveRow),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

function mapLeaveRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    leaveNumber: String(r.leave_number),
    status: String(r.status),
    fromDate: String(r.from_date),
    toDate: String(r.to_date),
    totalDays: Number(r.total_days),
    isHalfDay: Boolean(r.is_half_day),
    halfDayPeriod: (r.half_day_period as string) ?? null,
    reason: (r.reason as string) ?? null,
    submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
    approvedAt: r.approved_at ? new Date(r.approved_at as string).toISOString() : null,
    rejectedAt: r.rejected_at ? new Date(r.rejected_at as string).toISOString() : null,
    rejectionReason: (r.rejection_reason as string) ?? null,
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    employeeNumber: String(r.employee_number),
    department: (r.department as string) ?? null,
    leaveTypeId: String(r.leave_type_id),
    leaveTypeName: String(r.leave_type_name),
    leaveTypeCode: String(r.leave_type_code),
    isPaid: Boolean(r.is_paid),
  };
}

export async function getLeaveRequest(tx: Tx, id: string) {
  const [r] = (await tx.execute(sql`
    SELECT r.*, e.full_name AS employee_name, e.employee_number, e.user_id AS employee_user_id,
           d.name AS department, e.designation,
           lt.name AS leave_type_name, lt.code AS leave_type_code,
           lt.is_paid, lt.requires_document, lt.affects_balance,
           h.full_name AS handover_name
      FROM leave_requests r
      JOIN employees e        ON e.id = r.employee_id
      JOIN leave_types lt     ON lt.id = r.leave_type_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN employees h   ON h.id = r.handover_employee_id
     WHERE r.id = ${id}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  if (!r) return null;

  return {
    ...mapLeaveRow(r),
    notes: (r.notes as string) ?? null,
    designation: (r.designation as string) ?? null,
    employeeUserId: (r.employee_user_id as string) ?? null,
    requiresDocument: Boolean(r.requires_document),
    affectsBalance: Boolean(r.affects_balance),
    handoverEmployeeId: (r.handover_employee_id as string) ?? null,
    handoverName: (r.handover_name as string) ?? null,
    handoverNotes: (r.handover_notes as string) ?? null,
    submittedByName: (r.submitted_by_name as string) ?? null,
    approvedByName: (r.approved_by_name as string) ?? null,
    rejectedByName: (r.rejected_by_name as string) ?? null,
    cancelledByName: (r.cancelled_by_name as string) ?? null,
    cancellationReason: (r.cancellation_reason as string) ?? null,
    recalledAt: r.recalled_at ? new Date(r.recalled_at as string).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
  };
}

/** Approved and completed leave overlapping a window — the calendar. */
export async function getLeaveCalendar(
  tx: Tx,
  from: string,
  to: string,
) {
  const rows = (await tx.execute(sql`
    SELECT r.id, r.from_date, r.to_date, r.status, r.is_half_day,
           e.id AS employee_id, e.full_name AS employee_name,
           d.name AS department,
           lt.name AS leave_type_name, lt.code AS leave_type_code
      FROM leave_requests r
      JOIN employees e        ON e.id = r.employee_id
      JOIN leave_types lt     ON lt.id = r.leave_type_id
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE r.status IN ('approved', 'completed')
       AND r.from_date <= ${to}::date
       AND r.to_date   >= ${from}::date
     ORDER BY r.from_date
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    department: (r.department as string) ?? null,
    leaveTypeName: String(r.leave_type_name),
    leaveTypeCode: String(r.leave_type_code),
    fromDate: String(r.from_date),
    toDate: String(r.to_date),
    status: String(r.status),
    isHalfDay: Boolean(r.is_half_day),
  }));
}

/** The holidays in a window, so the calendar can show them alongside leave. */
export async function getHolidays(tx: Tx, companyId: string, from: string, to: string) {
  const rows = (await tx.execute(sql`
    SELECT holiday_date, name FROM holiday_dates(${companyId}::uuid, ${from}::date, ${to}::date)
     ORDER BY holiday_date
  `)) as unknown as Array<{ holiday_date: string; name: string }>;
  return rows.map((r) => ({ date: String(r.holiday_date).slice(0, 10), name: r.name }));
}

/** Who is away right now — a question about dates, not a status on a person. */
export async function getEmployeesOnLeaveToday(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT ol.employee_id, e.full_name, e.employee_number,
           lt.name AS leave_type_name, ol.from_date, ol.to_date
      FROM employees_on_leave ol
      JOIN employees e    ON e.id = ol.employee_id
      JOIN leave_types lt ON lt.id = ol.leave_type_id
     ORDER BY e.full_name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    name: String(r.full_name),
    employeeNumber: String(r.employee_number),
    leaveTypeName: String(r.leave_type_name),
    fromDate: String(r.from_date),
    toDate: String(r.to_date),
  }));
}

export async function countPendingApprovals(tx: Tx) {
  const [row] = (await tx.execute(
    sql`SELECT COUNT(*)::int AS n FROM leave_requests WHERE status = 'submitted'`,
  )) as unknown as Array<{ n: number }>;
  return Number(row.n);
}

// ── Year-end and accrual ─────────────────────────────────────────────────────

/**
 * Carries unused days into the next year.
 *
 * The source UPDATES THE EXISTING ROW — `"leaveBalances.$.year": toYear`, with
 * usedDays and pendingDays reset to 0 — so last year's record is overwritten
 * and the history of what anybody actually took is gone. Worse, the positional
 * `$` matches on leaveType alone, so which year's row it hits is whichever
 * happens to be first in the array.
 *
 * Here the previous year is left exactly as it was and a NEW row is written
 * for the next one. Idempotent: a second run recomputes the same carry-over
 * rather than adding to it.
 *
 * The cap is the leave type's own `max_carry_over`, per type, rather than one
 * number applied to every type at once.
 */
export async function runCarryOver(
  tx: Tx,
  input: {
    companyId: string;
    fromYear: number;
    toYear: number;
    /** Restrict to one type; otherwise every type that carries over. */
    leaveTypeId?: string | null;
  },
) {
  const typeFilter = input.leaveTypeId
    ? sql`AND lt.id = ${input.leaveTypeId}::uuid`
    : sql``;

  const rows = (await tx.execute(sql`
    WITH carried AS (
      SELECT b.employee_id,
             b.leave_type_id,
             LEAST(
               GREATEST(b.balance_days - b.pending_days, 0),
               lt.max_carry_over
             ) AS carry_over,
             lt.default_entitlement
        FROM leave_balances b
        JOIN leave_types lt ON lt.id = b.leave_type_id
        JOIN employees e    ON e.id = b.employee_id
       WHERE b.year = ${input.fromYear}
         AND lt.is_active
         AND lt.max_carry_over > 0
         AND e.status <> 'terminated'
         ${typeFilter}
    )
    INSERT INTO leave_entitlements
      (company_id, employee_id, leave_type_id, year, entitled_days, carry_over_days)
    SELECT ${input.companyId}::uuid, c.employee_id, c.leave_type_id,
           ${input.toYear}, c.default_entitlement, c.carry_over
      FROM carried c
     WHERE c.carry_over > 0
    ON CONFLICT (company_id, employee_id, leave_type_id, year)
    DO UPDATE SET carry_over_days = EXCLUDED.carry_over_days,
                  updated_at = now()
    RETURNING employee_id, carry_over_days
  `)) as unknown as Array<{ employee_id: string; carry_over_days: string }>;

  return {
    processed: rows.length,
    totalCarried: rows.reduce((sum, r) => sum + Number(r.carry_over_days), 0),
  };
}

/**
 * Accrues leave month by month.
 *
 * Written as "the entitlement at month N is N months' worth", NOT as an
 * increment. The source does `$inc` on entitledDays and balanceDays, so
 * running the accrual twice for the same month credits everybody twice and
 * nothing can tell afterwards — there is no record of which months were run.
 *
 * Stated as a total, running it again for the same month changes nothing, and
 * running it for a month that was missed catches up correctly.
 *
 * Employees who joined mid-year accrue from their hire month, which the source
 * does not do at all: everybody was credited the same regardless of when they
 * started.
 */
export async function runAccrual(
  tx: Tx,
  input: {
    companyId: string;
    year: number;
    /** Accrue up to and including this month. */
    throughMonth: number;
    leaveTypeId: string;
    /** Days earned per month. Kenya's 21-day entitlement is 1.75. */
    daysPerMonth: number;
  },
) {
  if (input.throughMonth < 1 || input.throughMonth > 12) {
    throw new Error("Month must be between 1 and 12");
  }
  if (!(input.daysPerMonth > 0)) {
    throw new Error("Days per month must be more than zero");
  }

  const rows = (await tx.execute(sql`
    WITH earned AS (
      SELECT e.id AS employee_id,
             /* Months of this year they have actually been employed for. */
             GREATEST(
               0,
               ${input.throughMonth}::int - CASE
                 WHEN EXTRACT(YEAR FROM e.hire_date)::int = ${input.year}
                   THEN EXTRACT(MONTH FROM e.hire_date)::int - 1
                 WHEN EXTRACT(YEAR FROM e.hire_date)::int > ${input.year}
                   THEN ${input.throughMonth}::int
                 ELSE 0
               END
             ) AS months
        FROM employees e
       WHERE e.status IN ('active', 'probation', 'on_leave')
    )
    INSERT INTO leave_entitlements
      (company_id, employee_id, leave_type_id, year, entitled_days)
    SELECT ${input.companyId}::uuid, earned.employee_id,
           ${input.leaveTypeId}::uuid, ${input.year},
           ROUND(earned.months * ${input.daysPerMonth}::numeric, 2)
      FROM earned
     WHERE earned.months > 0
    ON CONFLICT (company_id, employee_id, leave_type_id, year)
    DO UPDATE SET entitled_days = EXCLUDED.entitled_days,
                  updated_at = now()
    RETURNING employee_id, entitled_days
  `)) as unknown as Array<{ employee_id: string; entitled_days: string }>;

  return { processed: rows.length };
}

/**
 * Pays out unused days instead of taking them.
 *
 * Recorded in `encashed_days`, which reduces the balance in its own right. The
 * source adds them to usedDays, which makes a payout indistinguishable from
 * leave actually taken — so an attendance or absence report counts days the
 * employee spent at work.
 *
 * Returns the amount for payroll to put on the payslip; it does not create the
 * payslip line itself.
 */
export async function encashLeave(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    leaveTypeId: string;
    year: number;
    days: number;
    dailyRate: number;
  },
) {
  if (!(input.days > 0)) throw new Error("Days to encash must be more than zero");
  if (!(input.dailyRate > 0)) throw new Error("The daily rate must be more than zero");

  const [balance] = (await tx.execute(sql`
    SELECT available_days FROM leave_balances
     WHERE employee_id = ${input.employeeId}::uuid
       AND leave_type_id = ${input.leaveTypeId}::uuid
       AND year = ${input.year}
  `)) as unknown as Array<{ available_days: string }>;

  const available = Number(balance?.available_days ?? 0);
  if (input.days > available) {
    throw new Error(
      `Not enough leave to encash: ${available} day(s) available, ${input.days} requested.`,
    );
  }

  await tx.execute(sql`
    UPDATE leave_entitlements
       SET encashed_days = encashed_days + ${input.days},
           updated_at = now()
     WHERE employee_id = ${input.employeeId}::uuid
       AND leave_type_id = ${input.leaveTypeId}::uuid
       AND year = ${input.year}
  `);

  const amount = Math.round(input.days * input.dailyRate * 100) / 100;
  return { daysEncashed: input.days, amount };
}
