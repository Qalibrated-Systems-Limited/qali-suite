"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as repo from "../repositories/resourceRequests";
import * as notifications from "../repositories/notifications";
import { technicalStanding, requireTechnicalManager, listTechnicalPeople } from "../technicalAccess";
import {
  actor,
  applyApproval,
  createResourceRequestIn,
  requestSchema,
} from "../resourceRequestsService";

/**
 * Technical resources are requested, and the technical manager approves them.
 *
 * Anyone who needs a technician, a vehicle or test equipment for their work —
 * a help desk ticket, a project task, a contract — asks here. A technical
 * manager sees whether it is free and approves or rejects. Approval APPLIES the
 * request: the ticket, job, inspection or project task is assigned to the
 * technician. Nothing is assigned to a technical-department technician by
 * anyone else without it.
 */

function bump() {
  revalidatePath("/dashboard/technical/resources");
  revalidatePath("/dashboard/technical/my-work");
  revalidatePath("/dashboard/helpdesk");
  revalidatePath("/dashboard/tasks");
}

export async function requestResource(prevState: unknown, formData: FormData) {
  const raw = Object.fromEntries(
    ["resourceType", "resourceId", "sourceType", "sourceId", "sourceRef", "sourceTitle", "startDate", "endDate", "notes"].map(
      (k) => [k, typeof formData.get(k) === "string" ? String(formData.get(k)) : undefined],
    ),
  );
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant([], (tx, { user, companyId }) =>
      createResourceRequestIn(tx, user, companyId, parsed.data),
    );
    bump();
    return { success: true, message: `${row.requestNumber} sent to the technical manager for approval` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function decideResourceRequest(id: string, decision: "approved" | "rejected", note = "") {
  if (!["approved", "rejected"].includes(decision)) return { error: "Approve or reject." };
  try {
    const result = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      await requireTechnicalManager(tx, user, companyId);
      const before = await repo.getRequest(tx, id);
      if (!before) throw new Error("Request not found");
      if (decision === "approved") {
        const a = await repo.availability(tx, before.resourceType as repo.ResourceType, before.resourceId, before.startDate, before.endDate, before.id);
        if (a.blockers.length && !note.trim()) {
          throw new Error(`Not free: ${a.blockers[0]} Add a note to approve it anyway.`);
        }
      }
      const row = await repo.decideRequest(tx, id, decision, note, actor(user));
      if (!row) throw new Error("Request not found");
      const applied = decision === "approved" ? await applyApproval(tx, row, user) : null;
      const recipients = [row.requestedById, row.resourceType === "technician" && decision === "approved" ? row.resourceId : null]
        .filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i && x !== String(user.id));
      if (recipients.length) {
        await notifications.createMany(
          tx,
          recipients.map((uid) => ({
            companyId,
            userId: uid,
            type: "approval_request",
            title: `${row.requestNumber} ${decision}: ${row.resourceName}`,
            body: `${row.sourceRef || row.sourceTitle} · ${row.startDate} to ${row.endDate}${note.trim() ? ` — ${note.trim()}` : ""}`,
            href: uid === row.resourceId ? "/dashboard/tasks" : "/dashboard/technical/resources",
          })),
        );
      }
      return { row, applied };
    });
    bump();
    return {
      success: true,
      message: `${result.row.requestNumber} ${decision}${result.applied ? ` — ${result.applied}` : ""}`,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function cancelResourceRequest(id: string) {
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const r = await repo.getRequest(tx, id);
      if (!r) throw new Error("Request not found");
      const s = await technicalStanding(tx, user, companyId);
      if (r.requestedById !== String(user.id) && !s.isManager) {
        throw new Error("Only the person who asked, or a technical manager, can cancel it.");
      }
      return repo.cancelRequest(tx, id);
    });
    bump();
    return { success: true, message: `${row?.requestNumber} cancelled` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

/** The register page: the manager's queue and history, or the viewer's own requests. */
export async function getResourceRequests() {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const s = await technicalStanding(tx, user, companyId);
    const rows = await repo.listRequests(tx, s.isManager ? {} : { requestedById: String(user.id) });
    const pending = rows.filter((r) => r.status === "pending");
    const avail = s.isManager
      ? await Promise.all(
          pending.map((r) =>
            repo.availability(tx, r.resourceType as repo.ResourceType, r.resourceId, r.startDate, r.endDate, r.id),
          ),
        )
      : [];
    const availability = Object.fromEntries(pending.map((r, i) => [r.id, avail[i] ?? null]));
    return {
      me: { userId: String(user.id), isManager: s.isManager, isTechnician: s.isTechnician },
      requests: rows.map((r) => ({
        ...r,
        requestedAt: r.requestedAt instanceof Date ? r.requestedAt.toISOString() : r.requestedAt,
        decidedAt: r.decidedAt instanceof Date ? r.decidedAt.toISOString() : r.decidedAt,
        createdAt: undefined,
        updatedAt: undefined,
      })),
      availability,
    };
  });
}

export async function getResourceOptions() {
  return withAuthorizedTenant([], async (tx) => {
    const [people, opts] = await Promise.all([listTechnicalPeople(tx), repo.listResourceOptions(tx)]);
    return {
      technicians: people.map((p) => ({ id: p.id, name: p.name, title: p.title, department: p.department })),
      vehicles: opts.vehicles,
      equipment: opts.equipment,
    };
  });
}

/** Availability for the request form, before asking. */
export async function checkResourceAvailability(type: string, id: string, start: string, end: string) {
  if (!["technician", "vehicle", "equipment"].includes(type) || !id || !start || !end || end < start) return null;
  return withAuthorizedTenant([], (tx) => repo.availability(tx, type as repo.ResourceType, id, start, end));
}

