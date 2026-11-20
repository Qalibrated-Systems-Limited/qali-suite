"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as repo from "../repositories/technical";
import * as notifications from "../repositories/notifications";
import * as helpdeskRepo from "../repositories/helpdesk";
import {
  technicalStanding,
  requireTechnician,
  requireTechnicalManager,
  listTechnicalPeople,
} from "../technicalAccess";

/**
 * Technical department actions — Calibration (17025) & Inspection (17020), 0079.
 * Same shape as the report actions: Zod validates, `withAuthorizedTenant`
 * scopes, the repository does the SQL. Writes return {success,message} or
 * {error}; reads are open to any authenticated member of the company.
 */

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function revalidateCal() {
  revalidatePath("/dashboard/calibration");
  revalidatePath("/dashboard/technical/overview");
}
function revalidateIns() {
  revalidatePath("/dashboard/inspection");
}

type TenantTx = Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0];
type SessionUser = { id?: string | null; name?: string | null; role?: string | null };

/**
 * Who new work goes to. A technical manager may give it to anyone on the
 * technical team (or leave it unassigned); a technician who logs work found on
 * site gets it themselves.
 */
async function assigneeFor(
  tx: TenantTx,
  user: SessionUser,
  companyId: string,
  requestedId?: string,
): Promise<{ id: string; name: string } | null> {
  const standing = await requireTechnician(tx, user, companyId);
  if (!standing.isManager) {
    return { id: String(user.id), name: user.name || "Unknown User" };
  }
  if (!requestedId) return null;
  const people = await listTechnicalPeople(tx);
  const person = people.find((p) => p.id === requestedId);
  if (!person) throw new Error("Choose someone from the technical team.");
  return { id: person.id, name: person.name };
}

async function tellAssignee(
  tx: TenantTx,
  companyId: string,
  by: SessionUser,
  to: { id: string; name: string } | null,
  title: string,
  href = "/dashboard/technical/my-work",
) {
  if (!to?.id || to.id === by.id) return;
  await notifications.createMany(tx, [
    { companyId, userId: to.id, type: "approval_request", title: `Assigned to you: ${title}`, body: `From ${by.name || "your manager"}`, href },
  ]);
}

async function tell(
  tx: TenantTx,
  companyId: string,
  userId: string | null | undefined,
  title: string,
  body: string,
  href = "/dashboard/technical/my-work",
) {
  if (!userId) return;
  await notifications.createMany(tx, [{ companyId, userId, type: "approval_request", title, body, href }]);
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getCalibrationData() {
  return withAuthorizedTenant([], async (tx) => {
    const [jobs, standards, stats] = await Promise.all([
      repo.listJobs(tx),
      repo.listStandards(tx),
      repo.getCalibrationStats(tx),
    ]);
    return {
      jobs: jobs.map((r) => ({ ...r, _id: String(r.id) })),
      standards: standards.map((r) => ({ ...r, _id: String(r.id) })),
      stats,
    };
  });
}

export async function getInspectionData() {
  return withAuthorizedTenant([], async (tx) => {
    const [rows, inspectors, stats] = await Promise.all([
      repo.listInspections(tx),
      repo.listInspectors(tx),
      repo.getInspectionStats(tx),
    ]);
    return {
      inspections: rows.map((r) => ({ ...r, _id: String(r.id) })),
      inspectors,
      stats,
    };
  });
}

// ── Calibration jobs ──────────────────────────────────────────────────────────
const jobSchema = z.object({
  clientName: z.string().trim().min(1, "Client is required").max(200),
  site: z.string().trim().max(200).optional(),
  serviceType: z.string().trim().max(120).optional(),
  scheduledDate: z.string().optional(),
  technicianId: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCalibrationJob(prevState: unknown, formData: FormData) {
  const parsed = jobSchema.safeParse({
    clientName: s(formData.get("clientName")),
    site: s(formData.get("site")),
    serviceType: s(formData.get("serviceType")),
    scheduledDate: s(formData.get("scheduledDate")),
    technicianId: s(formData.get("technicianId")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Check the form" };
  }
  const { technicianId, ...d } = parsed.data;
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const to = await assigneeFor(tx, user, companyId, technicianId);
      const created = await repo.createJob(tx, {
        companyId,
        ...d,
        technicianId: to?.id ?? null,
        technicianName: to?.name ?? "",
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      });
      await tellAssignee(tx, companyId, user, to, `${created.jobNumber} — calibration for ${created.clientName}`);
      return created;
    });
    revalidateCal();
    return { success: true, message: `${row.jobNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setCalibrationJobOutcome(
  id: string,
  input: { status?: string; result?: string; billingStatus?: string },
) {
  try {
    const row = await withAuthorizedTenant(
      [],
      async (tx, { user, companyId }) => {
        await requireTechnicalManager(tx, user, companyId);
        // Status and result now move through start → submit → approve; this
        // is left for billing only, so a result cannot skip its sign-off.
        const updated = await repo.setJobOutcome(
          tx,
          id,
          { billingStatus: input.billingStatus },
          actorFrom(user),
        );
        if (!updated) throw new Error("Job not found");
        return updated;
      },
    );
    revalidateCal();
    return { success: true, message: `${row.jobNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCalibrationJob(id: string) {
  try {
    await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      await requireTechnicalManager(tx, user, companyId);
      const job = await repo.getJobById(tx, id);
      if (job?.status === "approved") throw new Error("An approved job cannot be deleted — it has a certificate.");
      return repo.deleteJob(tx, id);
    });
    revalidateCal();
    return { success: true, message: "Job deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Calibration standards ─────────────────────────────────────────────────────
const standardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  traceability: z.string().trim().max(200).optional(),
  lastCalibration: z.string().optional(),
  nextCalibration: z.string().optional(),
  uncertainty: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCalibrationStandard(prevState: unknown, formData: FormData) {
  const parsed = standardSchema.safeParse({
    name: s(formData.get("name")),
    traceability: s(formData.get("traceability")),
    lastCalibration: s(formData.get("lastCalibration")),
    nextCalibration: s(formData.get("nextCalibration")),
    uncertainty: s(formData.get("uncertainty")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      await requireTechnicalManager(tx, user, companyId);
      return repo.createStandard(tx, { companyId, ...d, createdById: actorFrom(user).id, createdByName: actorFrom(user).name });
    });
    revalidateCal();
    return { success: true, message: "Reference standard added" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCalibrationStandard(id: string) {
  try {
    await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      await requireTechnicalManager(tx, user, companyId);
      return repo.deleteStandard(tx, id);
    });
    revalidateCal();
    return { success: true, message: "Standard removed" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Inspections ───────────────────────────────────────────────────────────────
const inspectionSchema = z.object({
  clientName: z.string().trim().min(1, "Client is required").max(200),
  type: z.string().trim().max(120).optional(),
  equipmentSerial: z.string().trim().max(120).optional(),
  inspectorId: z.string().trim().max(120).optional(),
  scheduledDate: z.string().optional(),
  authorityExpiry: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createInspection(prevState: unknown, formData: FormData) {
  const parsed = inspectionSchema.safeParse({
    clientName: s(formData.get("clientName")),
    type: s(formData.get("type")),
    equipmentSerial: s(formData.get("equipmentSerial")),
    inspectorId: s(formData.get("inspectorId")),
    scheduledDate: s(formData.get("scheduledDate")),
    authorityExpiry: s(formData.get("authorityExpiry")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const { inspectorId, ...d } = parsed.data;
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const to = await assigneeFor(tx, user, companyId, inspectorId);
      const created = await repo.createInspection(tx, {
        companyId,
        ...d,
        inspectorId: to?.id ?? null,
        inspectorName: to?.name ?? "",
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      });
      await tellAssignee(tx, companyId, user, to, `${created.inspectionNumber} — inspection for ${created.clientName}`);
      return created;
    });
    revalidateIns();
    return { success: true, message: `${row.inspectionNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setInspectionOutcome(
  id: string,
  input: { ruling?: string; appealStatus?: string },
) {
  try {
    const row = await withAuthorizedTenant(
      [],
      async (tx, { user, companyId }) => {
        await requireTechnicalManager(tx, user, companyId);
        // The ruling is recorded by the inspector on submit; this is left for
        // the appeal, which is a manager's matter.
        const updated = await repo.setInspectionOutcome(
          tx,
          id,
          { appealStatus: input.appealStatus },
          actorFrom(user),
        );
        if (!updated) throw new Error("Inspection not found");
        return updated;
      },
    );
    revalidateIns();
    return { success: true, message: `${row.inspectionNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteInspection(id: string) {
  try {
    await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      await requireTechnicalManager(tx, user, companyId);
      const ins = await repo.getInspectionById(tx, id);
      if (ins?.status === "approved") throw new Error("An approved inspection cannot be deleted.");
      return repo.deleteInspection(tx, id);
    });
    revalidateIns();
    return { success: true, message: "Inspection deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Documents ─────────────────────────────────────────────────────────────────

/** An issued calibration certificate and the reference standards on file. */
export async function getCalibrationCertificate(id: string) {
  return withAuthorizedTenant([], async (tx) => {
    const job = await repo.getJobById(tx, id);
    if (!job) return null;
    const standards = await repo.listStandards(tx);
    return { job, standards };
  });
}

export async function getInspectionForReport(id: string) {
  return withAuthorizedTenant([], (tx) => repo.getInspectionById(tx, id));
}

// ── Assigned work: start → submit → approve / return ─────────────────────────
//
// One set of actions for calibration jobs and inspections. The person doing
// the work (or a technical manager) starts and submits it with the result;
// a technical manager who did not do it approves or returns it.

type Kind = repo.WorkKind;

function labelOf(kind: Kind, row: Record<string, unknown>) {
  return String(kind === "job" ? row.jobNumber : row.inspectionNumber);
}

function revalidateWork(kind: Kind) {
  if (kind === "job") revalidateCal();
  else revalidateIns();
  revalidatePath("/dashboard/technical/my-work");
}

/** The viewer's standing, so screens show only the buttons that will work. */
export async function getMyTechnicalStanding() {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const s = await technicalStanding(tx, user, companyId);
    return { userId: String(user.id), isManager: s.isManager, isTechnician: s.isTechnician };
  });
}

export async function getTechnicalTeam() {
  return withAuthorizedTenant([], (tx) => listTechnicalPeople(tx));
}

export async function getMyWork() {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const s = await technicalStanding(tx, user, companyId);
    const work = await repo.getMyWork(tx, String(user.id), s.isManager);
    return { ...work, isManager: s.isManager, isTechnician: s.isTechnician, userId: String(user.id) };
  });
}

/** May this user act on this item as the one doing the work? */
async function requireWorker(tx: TenantTx, user: SessionUser, companyId: string, kind: Kind, row: Record<string, unknown>) {
  const s = await requireTechnician(tx, user, companyId);
  const assignee = repo.assigneeOf(kind, row);
  if (s.isManager || !assignee || assignee === String(user.id)) return s;
  throw new Error("This work is assigned to someone else. Ask a technical manager to reassign it.");
}

async function runWork(kind: Kind, id: string, fn: (tx: TenantTx, user: SessionUser, companyId: string, row: Record<string, unknown>) => Promise<Record<string, unknown> | null>, message: (label: string) => string) {
  try {
    const label = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const row = await repo.getWork(tx, kind, id);
      if (!row) throw new Error(kind === "job" ? "Job not found" : "Inspection not found");
      const updated = await fn(tx, user, companyId, row as Record<string, unknown>);
      return labelOf(kind, (updated ?? row) as Record<string, unknown>);
    });
    revalidateWork(kind);
    return { success: true, message: message(label) };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function assignTechnicalWork(kind: Kind, id: string, userId: string) {
  return runWork(kind, id, async (tx, user, companyId, row) => {
    await requireTechnicalManager(tx, user, companyId);
    let to: { id: string; name: string } | null = null;
    if (userId) {
      const person = (await listTechnicalPeople(tx)).find((p) => p.id === userId);
      if (!person) throw new Error("Choose someone from the technical team.");
      to = { id: person.id, name: person.name };
    }
    const updated = await repo.assignWork(tx, kind, id, to, actorFrom(user));
    await tellAssignee(tx, companyId, user, to, `${labelOf(kind, row)} — ${String(row.clientName)}`);
    return updated;
  }, (l) => (userId ? `${l} assigned` : `${l} unassigned`));
}

export async function startTechnicalWork(kind: Kind, id: string) {
  return runWork(kind, id, async (tx, user, companyId, row) => {
    await requireWorker(tx, user, companyId, kind, row);
    return repo.startWork(tx, kind, id, actorFrom(user));
  }, (l) => `${l} started`);
}

export async function submitTechnicalWork(
  kind: Kind,
  id: string,
  outcome: { result?: string; ruling?: string; notes?: string },
) {
  return runWork(kind, id, async (tx, user, companyId, row) => {
    await requireWorker(tx, user, companyId, kind, row);
    const updated = await repo.submitWork(tx, kind, id, outcome ?? {}, actorFrom(user));
    // Every technical manager other than the submitter hears it is waiting.
    const managers = (await listTechnicalPeople(tx)).filter((p) => p.isManager && p.id !== String(user.id));
    for (const m of managers) {
      await tell(tx, companyId, m.id, `${labelOf(kind, row)} is waiting for your approval`, `Submitted by ${user.name || "a technician"}`);
    }
    return updated;
  }, (l) => `${l} submitted for approval`);
}

export async function approveTechnicalWork(kind: Kind, id: string) {
  return runWork(kind, id, async (tx, user, companyId, row) => {
    await requireTechnicalManager(tx, user, companyId);
    const updated = await repo.approveWork(tx, kind, id, actorFrom(user));
    await tell(tx, companyId, repo.assigneeOf(kind, row), `${labelOf(kind, row)} was approved`, `By ${user.name || "your manager"}`);
    return updated;
  }, (l) => `${l} approved`);
}

export async function returnTechnicalWork(kind: Kind, id: string, comment: string) {
  return runWork(kind, id, async (tx, user, companyId, row) => {
    await requireTechnicalManager(tx, user, companyId);
    const updated = await repo.returnWork(tx, kind, id, String(comment ?? ""), actorFrom(user));
    await tell(tx, companyId, repo.assigneeOf(kind, row), `${labelOf(kind, row)} was returned to you`, String(comment ?? "").trim());
    return updated;
  }, (l) => `${l} returned to the technician`);
}

export async function reopenTechnicalWork(kind: Kind, id: string) {
  return runWork(kind, id, async (tx, user, companyId) => {
    await requireTechnicalManager(tx, user, companyId);
    return repo.reopenWork(tx, kind, id, actorFrom(user));
  }, (l) => `${l} reopened — it needs approving again`);
}

export async function cancelTechnicalWork(kind: Kind, id: string) {
  return runWork(kind, id, async (tx, user, companyId) => {
    await requireTechnicalManager(tx, user, companyId);
    return repo.cancelWork(tx, kind, id, actorFrom(user));
  }, (l) => `${l} cancelled`);
}

/** Help desk tickets for the Technical module (see listTicketsForTechnical). */
export async function getTechnicalTickets(all = false) {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const [standing, team] = await Promise.all([technicalStanding(tx, user, companyId), listTechnicalPeople(tx)]);
    const rows = await helpdeskRepo.listTicketsForTechnical(tx, team.map((p) => p.id), all && standing.isManager);
    return {
      tickets: rows.map((r) => ({
        ...r,
        resolutionDueAt: r.resolutionDueAt ? new Date(r.resolutionDueAt).toISOString() : null,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
      team,
      me: { userId: String(user.id), isManager: standing.isManager, isTechnician: standing.isTechnician },
    };
  });
}
