import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { withAuthorizedTenant } from "./tenant";
import * as repo from "./repositories/resourceRequests";
import * as notifications from "./repositories/notifications";
import * as helpdeskRepo from "./repositories/helpdesk";
import * as technicalRepo from "./repositories/technical";
import { technicalStanding, listTechnicalPeople } from "./technicalAccess";

/**
 * Resource requests — the server-only half. Kept out of the "use server"
 * actions file on purpose: everything exported there can be called from a
 * browser, and these take a transaction and trust their caller.
 */

export type TenantTx = Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0];
export type SessionUser = { id?: string | null; name?: string | null; role?: string | null };

export const actor = (u: SessionUser) => ({ id: u?.id ? String(u.id) : null, name: u?.name || "Unknown User" });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
export const requestSchema = z
  .object({
    resourceType: z.enum(["technician", "vehicle", "equipment"]),
    resourceId: z.string().trim().min(1, "Choose what you need"),
    sourceType: z.enum(["ticket", "project_task", "project", "contract", "calibration_job", "inspection", "other"]),
    sourceId: z.string().trim().max(120).optional(),
    sourceRef: z.string().trim().max(120).optional(),
    sourceTitle: z.string().trim().max(240).optional(),
    startDate: isoDate,
    endDate: isoDate,
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "The end date is before the start date", path: ["endDate"] });

/** The name of the thing requested, read from the register — never trusted from the form. */
export async function resolveResource(tx: TenantTx, type: string, id: string) {
  if (type === "technician") {
    const p = (await listTechnicalPeople(tx)).find((x) => x.id === id);
    if (!p) throw new Error("Choose someone from the technical team.");
    return p.name;
  }
  const opts = await repo.listResourceOptions(tx);
  const hit = (type === "vehicle" ? opts.vehicles : opts.equipment).find((x) => x.id === id);
  if (!hit) throw new Error(type === "vehicle" ? "Choose a vehicle on the fleet register." : "Choose equipment on the register.");
  return hit.name;
}

async function tellManagers(tx: TenantTx, companyId: string, exceptId: string | null, title: string, body: string) {
  const managers = (await listTechnicalPeople(tx)).filter((p) => p.isManager && p.id !== exceptId);
  if (!managers.length) return;
  await notifications.createMany(
    tx,
    managers.map((m) => ({ companyId, userId: m.id, type: "approval_request", title, body, href: "/dashboard/technical/resources" })),
  );
}

/** Create a request (internal — also used by help desk and projects). */
export async function createResourceRequestIn(
  tx: TenantTx,
  user: SessionUser,
  companyId: string,
  input: z.infer<typeof requestSchema>,
) {
  const resourceName = await resolveResource(tx, input.resourceType, input.resourceId);
  const row = await repo.createRequest(tx, {
    companyId,
    ...input,
    resourceName,
    requestedBy: actor(user),
  });
  await tellManagers(
    tx,
    companyId,
    actor(user).id,
    `${row.requestNumber}: ${resourceName} requested`,
    `${input.sourceRef || input.sourceTitle || "Work"} · ${input.startDate} to ${input.endDate} · by ${actor(user).name}`,
  );
  return row;
}

/** The project party that stands for this login, for assigning a project task. */
async function partyForUser(tx: TenantTx, userId: string) {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(e.party_id, p.id)::text AS id
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      LEFT JOIN parties p ON p.user_id::text = u.id
     WHERE u.id = ${userId}
     LIMIT 1
  `)) as unknown as Array<{ id: string | null }>;
  return row?.id ?? null;
}

/** Approval applies the request to the work it was for. */
export async function applyApproval(tx: TenantTx, req: NonNullable<Awaited<ReturnType<typeof repo.getRequest>>>, by: SessionUser) {
  if (req.resourceType !== "technician" || !req.sourceId) return null;
  const who = { id: req.resourceId, name: req.resourceName };
  switch (req.sourceType) {
    case "ticket":
      await helpdeskRepo.assignTicket(tx, req.sourceId, { userId: who.id, name: who.name }, actor(by));
      return "ticket assigned";
    case "calibration_job":
      await technicalRepo.assignWork(tx, "job", req.sourceId, who, actor(by));
      return "job assigned";
    case "inspection":
      await technicalRepo.assignWork(tx, "inspection", req.sourceId, who, actor(by));
      return "inspection assigned";
    case "project_task": {
      const partyId = await partyForUser(tx, who.id);
      if (!partyId) return "booked — link the technician to their employee record to assign project tasks";
      await tx.execute(sql`
        UPDATE project_tasks SET assigned_party_id = ${partyId}::uuid, assigned_name = ${who.name}, updated_at = now()
         WHERE id = ${req.sourceId}::uuid
      `);
      return "project task assigned";
    }
    default:
      return null;
  }
}

/**
 * Must assigning this person go through a resource request? Yes when they are
 * a technician in the Technical department and the one assigning is not a
 * technical manager.
 */
export async function needsResourceApproval(tx: TenantTx, user: SessionUser, companyId: string, assigneeId: string) {
  const s = await technicalStanding(tx, user, companyId);
  if (s.isManager) return false;
  const person = (await listTechnicalPeople(tx)).find((p) => p.id === assigneeId);
  return Boolean(person && !person.isManager && person.department.trim().toLowerCase() === "technical");
}
