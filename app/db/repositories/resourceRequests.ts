import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { resourceRequests } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Technical resources — technicians, vehicles, test equipment — requested for
 * a piece of work and approved by the technical manager. RLS-scoped `tx`; the
 * rules about who may ask and who may decide live in resource-actions.ts.
 */

export type ResourceType = "technician" | "vehicle" | "equipment";
export type SourceType =
  | "ticket"
  | "project_task"
  | "project"
  | "contract"
  | "calibration_job"
  | "inspection"
  | "other";
type Person = { id: string | null; name: string };

export interface NewResourceRequest {
  companyId: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  sourceType: SourceType;
  sourceId?: string | null;
  sourceRef?: string;
  sourceTitle?: string;
  startDate: string;
  endDate: string;
  notes?: string;
  requestedBy: Person;
}

export async function createRequest(tx: Tx, input: NewResourceRequest) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'RES') AS n`,
  )) as unknown as Array<{ n: string }>;
  const [row] = await tx
    .insert(resourceRequests)
    .values({
      companyId: input.companyId,
      requestNumber: n,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceName: input.resourceName,
      sourceType: input.sourceType,
      sourceId: input.sourceId || null,
      sourceRef: input.sourceRef?.trim() ?? "",
      sourceTitle: input.sourceTitle?.trim() ?? "",
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes?.trim() ?? "",
      requestedById: input.requestedBy.id,
      requestedByName: input.requestedBy.name,
    })
    .returning();
  return row;
}

export async function getRequest(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(resourceRequests).where(eq(resourceRequests.id, id));
  return row ?? null;
}

export function listRequests(tx: Tx, opts: { status?: string; requestedById?: string } = {}) {
  const where = [] as ReturnType<typeof eq>[];
  if (opts.status) where.push(eq(resourceRequests.status, opts.status));
  if (opts.requestedById) where.push(eq(resourceRequests.requestedById, opts.requestedById));
  return tx
    .select()
    .from(resourceRequests)
    .where(where.length ? and(...where) : undefined)
    .orderBy(
      sql`CASE ${resourceRequests.status} WHEN 'pending' THEN 0 ELSE 1 END`,
      resourceRequests.startDate,
      desc(resourceRequests.requestedAt),
    )
    .limit(300);
}

async function setStatus(tx: Tx, id: string, set: Record<string, unknown>) {
  const [row] = await tx
    .update(resourceRequests)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(resourceRequests.id, id))
    .returning();
  return row ?? null;
}

export async function decideRequest(
  tx: Tx,
  id: string,
  decision: "approved" | "rejected",
  note: string,
  actor: Person,
) {
  const current = await getRequest(tx, id);
  if (!current) return null;
  if (current.status !== "pending") throw new Error("This request has already been decided.");
  if (decision === "rejected" && !note.trim()) {
    throw new Error("Say why it is rejected, so the requester can plan around it.");
  }
  return setStatus(tx, id, {
    status: decision,
    decidedById: actor.id,
    decidedByName: actor.name,
    decidedAt: new Date(),
    decisionNote: note.trim(),
  });
}

export async function cancelRequest(tx: Tx, id: string) {
  const current = await getRequest(tx, id);
  if (!current) return null;
  if (current.status !== "pending") throw new Error("Only a pending request can be cancelled.");
  return setStatus(tx, id, { status: "cancelled" });
}

/** Everything that can be requested, for the request form. */
export async function listResourceOptions(tx: Tx) {
  const vehicles = (await tx.execute(sql`
    SELECT id::text AS id, reg_no || ' — ' || COALESCE(NULLIF(trim(concat_ws(' ', make, model)), ''), 'vehicle') AS name, status
      FROM fleet_vehicles WHERE status <> 'retired' ORDER BY reg_no
  `)) as unknown as Array<{ id: string; name: string; status: string }>;
  const equipment = (await tx.execute(sql`
    SELECT id::text AS id, name, next_calibration AS "nextCalibration"
      FROM calibration_standards ORDER BY name
  `)) as unknown as Array<{ id: string; name: string; nextCalibration: string | null }>;
  return { vehicles, equipment };
}

export interface Availability {
  /** Reasons it should not be approved as asked. */
  blockers: string[];
  /** Worth knowing before deciding. */
  warnings: string[];
  /** Other requests for the same resource overlapping the period. */
  overlaps: Array<{ requestNumber: string; status: string; sourceRef: string; sourceTitle: string; startDate: string; endDate: string }>;
  /** Technicians: open assigned work right now. */
  openWork: number | null;
}

/**
 * Is this resource free for [start, end]? What the technical manager sees
 * before deciding. Technician: approved leave, other approved bookings, open
 * work. Vehicle: grounded, service or insurance falling in the period.
 * Equipment: a reference standard whose calibration lapses before the end.
 */
export async function availability(
  tx: Tx,
  type: ResourceType,
  resourceId: string,
  start: string,
  end: string,
  excludeId: string | null = null,
): Promise<Availability> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const overlaps = (await tx.execute(sql`
    SELECT request_number AS "requestNumber", status, source_ref AS "sourceRef", source_title AS "sourceTitle",
           to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate"
      FROM resource_requests
     WHERE resource_type = ${type} AND resource_id = ${resourceId}
       AND status IN ('approved','pending')
       AND start_date <= ${end}::date AND end_date >= ${start}::date
       AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
     ORDER BY start_date
  `)) as unknown as Availability["overlaps"];
  for (const o of overlaps) {
    if (o.status === "approved") {
      blockers.push(`Already booked ${o.startDate} to ${o.endDate} for ${o.sourceRef || o.sourceTitle || o.requestNumber}.`);
    } else {
      warnings.push(`Also requested ${o.startDate} to ${o.endDate} (${o.requestNumber}, pending).`);
    }
  }

  let openWork: number | null = null;
  if (type === "technician") {
    const leave = (await tx.execute(sql`
      SELECT l.leave_number AS "leaveNumber", l.status,
             to_char(l.from_date, 'YYYY-MM-DD') AS "from", to_char(l.to_date, 'YYYY-MM-DD') AS "to"
        FROM leave_requests l
        JOIN employees e ON e.id = l.employee_id
       WHERE e.user_id = ${resourceId}
         AND l.status IN ('submitted','approved')
         AND l.from_date <= ${end}::date AND l.to_date >= ${start}::date
    `)) as unknown as Array<{ leaveNumber: string; status: string; from: string; to: string }>;
    for (const l of leave) {
      if (l.status === "approved") blockers.push(`On approved leave ${l.from} to ${l.to}.`);
      else warnings.push(`Has applied for leave ${l.from} to ${l.to} (not yet approved).`);
    }
    const [w] = (await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM helpdesk_tickets WHERE assigned_to_user_id = ${resourceId} AND status NOT IN ('resolved','closed'))
      + (SELECT count(*) FROM calibration_jobs WHERE technician_id = ${resourceId} AND status IN ('scheduled','in_progress','returned'))
      + (SELECT count(*) FROM inspections WHERE inspector_id = ${resourceId} AND status IN ('scheduled','in_progress','returned'))
      + (SELECT count(*) FROM tasks WHERE assigned_to_user_id = ${resourceId} AND status IN ('open','in_progress','blocked'))
        AS n
    `)) as unknown as Array<{ n: number }>;
    openWork = Number(w?.n ?? 0);
    if (openWork >= 8) warnings.push(`Carrying ${openWork} open items already.`);
  } else if (type === "vehicle" && isUuid(resourceId)) {
    const [v] = (await tx.execute(sql`
      SELECT status, to_char(next_service_date, 'YYYY-MM-DD') AS "service",
             to_char(insurance_expiry, 'YYYY-MM-DD') AS "insurance"
        FROM fleet_vehicles WHERE id = ${resourceId}::uuid
    `)) as unknown as Array<{ status: string; service: string | null; insurance: string | null }>;
    if (!v) blockers.push("This vehicle is no longer on the fleet register.");
    else {
      if (v.status === "grounded") blockers.push("The vehicle is grounded.");
      if (v.status === "retired") blockers.push("The vehicle is retired.");
      if (v.status === "service_due") warnings.push("The vehicle is due for service.");
      if (v.insurance && v.insurance < end) blockers.push(`Insurance expires ${v.insurance}, before the booking ends.`);
      if (v.service && v.service >= start && v.service <= end) warnings.push(`A service is due on ${v.service}.`);
    }
  } else if (type === "equipment" && isUuid(resourceId)) {
    const [e] = (await tx.execute(sql`
      SELECT to_char(next_calibration, 'YYYY-MM-DD') AS "due" FROM calibration_standards WHERE id = ${resourceId}::uuid
    `)) as unknown as Array<{ due: string | null }>;
    if (!e) blockers.push("This equipment is no longer on the register.");
    else if (e.due && e.due < start) blockers.push(`Its calibration lapsed on ${e.due}; it cannot be used for traceable work.`);
    else if (e.due && e.due <= end) warnings.push(`Its calibration is due ${e.due}, during the booking.`);
  }

  return { blockers, warnings, overlaps, openWork };
}
