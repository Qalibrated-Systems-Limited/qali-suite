"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import type { Tx } from "../client";
import { HSE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/hse";

/**
 * HSE actions — 0090. Reads open to any authenticated member of the company;
 * writes need HSE_WRITE_ROLES. Same shape as technical-actions.ts.
 */

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function bump() {
  revalidatePath("/dashboard/hse");
}
const WRITE = HSE_WRITE_ROLES as unknown as string[];

// ── reads ────────────────────────────────────────────────────────────────────
export async function getHseData() {
  return withAuthorizedTenant([], async (tx) => {
    const [dashboard, incidents, sites, rams, ppe, toolbox, training, inspections] = await Promise.all([
      repo.getHseDashboard(tx),
      repo.listIncidents(tx),
      repo.listSites(tx),
      repo.listRams(tx),
      repo.listPpe(tx),
      repo.listToolbox(tx),
      repo.listTraining(tx),
      repo.listStatutory(tx),
    ]);
    const map = (rows: unknown[]) => rows.map((r) => ({ ...(r as object), _id: String((r as { id: string }).id) }));
    return {
      dashboard,
      incidents: map(incidents),
      sites: map(sites),
      rams: map(rams),
      ppe: map(ppe),
      toolbox: map(toolbox),
      training: map(training),
      inspections: map(inspections),
    };
  });
}

export async function getIncidentDetail(id: string) {
  return withAuthorizedTenant([], async (tx) => {
    const incident = await repo.getIncidentById(tx, id);
    if (!incident) return null;
    const actions = await repo.getIncidentActions(tx, id);
    return {
      incident: { ...incident, _id: String(incident.id) },
      actions: actions.map((a) => ({ ...a, _id: String(a.id) })),
    };
  });
}

// small helper for the write wrapper — every mutation runs through this.
async function write<T>(
  fn: (tx: Tx, ctx: { user: { id?: string | null; name?: string | null }; companyId: string }) => Promise<T>,
) {
  return withAuthorizedTenant(WRITE, fn);
}

function ok(message: string) {
  bump();
  return { success: true, message };
}
function fail(error: unknown) {
  return { error: userMessage(error) };
}

// ── Sites ──────────────────────────────────────────────────────────────────
export async function createSite(prevState: unknown, formData: FormData) {
  const name = s(formData.get("name")).trim();
  if (!name) return { error: "A site needs a name" };
  try {
    await write((tx, { user, companyId }) =>
      repo.createSite(tx, {
        companyId,
        name,
        location: s(formData.get("location")),
        projectName: s(formData.get("projectName")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok(`Site "${name}" added`);
  } catch (e) {
    return fail(e);
  }
}
export async function deleteSite(id: string) {
  try {
    await write((tx) => repo.deleteSite(tx, id));
    return ok("Site removed");
  } catch (e) {
    return fail(e);
  }
}

// ── Incidents ─────────────────────────────────────────────────────────────────
const incidentSchema = z.object({
  type: z.enum(["near_miss", "first_aid", "medical_treatment", "lost_time_injury", "positive_observation"]),
  severity: z.enum(["none", "low", "medium", "high", "critical"]),
  siteName: z.string().trim().max(200).optional(),
  occurredAt: z.string().optional(),
  reportedByName: z.string().trim().max(160).optional(),
  description: z.string().trim().max(4000).optional(),
});

export async function createIncident(prevState: unknown, formData: FormData) {
  const parsed = incidentSchema.safeParse({
    type: s(formData.get("type")),
    severity: s(formData.get("severity")),
    siteName: s(formData.get("siteName")),
    occurredAt: s(formData.get("occurredAt")),
    reportedByName: s(formData.get("reportedByName")),
    description: s(formData.get("description")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const isEnv = s(formData.get("isEnvironmental")) === "on";
  try {
    const row = await write((tx, { user, companyId }) =>
      repo.createIncident(tx, {
        companyId,
        ...parsed.data,
        isEnvironmental: isEnv,
        nemaRef: s(formData.get("nemaRef")),
        nemaNotificationRequired: isEnv && s(formData.get("nemaNotificationRequired")) === "on",
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok(`${row.incidentNumber} logged`);
  } catch (e) {
    return fail(e);
  }
}

export async function setIncidentStatus(id: string, status: string) {
  try {
    await write(async (tx, { user }) => {
      const r = await repo.setIncidentStatus(tx, id, status, actorFrom(user));
      if (!r) throw new Error("Incident not found");
      return r;
    });
    return ok("Incident updated");
  } catch (e) {
    return fail(e);
  }
}

export async function markNemaNotified(id: string) {
  try {
    await write((tx) => repo.markNemaNotified(tx, id));
    return ok("NEMA notification recorded");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteIncident(id: string) {
  try {
    await write((tx) => repo.deleteIncident(tx, id));
    return ok("Incident deleted");
  } catch (e) {
    return fail(e);
  }
}

// ── Corrective actions ────────────────────────────────────────────────────────
export async function addCorrectiveAction(incidentId: string, formData: FormData) {
  const description = s(formData.get("description")).trim();
  if (!description) return { error: "Describe the corrective action" };
  try {
    await write((tx, { user, companyId }) =>
      repo.createCorrectiveAction(tx, {
        companyId,
        incidentId,
        description,
        ownerName: s(formData.get("ownerName")),
        dueDate: s(formData.get("dueDate")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok("Corrective action added");
  } catch (e) {
    return fail(e);
  }
}

export async function setCorrectiveActionStatus(id: string, status: string) {
  try {
    await write(async (tx, { user }) => {
      const r = await repo.setCorrectiveActionStatus(tx, id, status, actorFrom(user));
      if (!r) throw new Error("Action not found");
      return r;
    });
    return ok("Action updated");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCorrectiveAction(id: string) {
  try {
    await write((tx) => repo.deleteCorrectiveAction(tx, id));
    return ok("Action removed");
  } catch (e) {
    return fail(e);
  }
}

// ── RAMS ────────────────────────────────────────────────────────────────────
export async function createRams(prevState: unknown, formData: FormData) {
  const title = s(formData.get("title")).trim();
  if (!title) return { error: "A RAMS needs a title" };
  try {
    const row = await write((tx, { user, companyId }) =>
      repo.createRams(tx, {
        companyId,
        title,
        siteName: s(formData.get("siteName")),
        subcontractorName: s(formData.get("subcontractorName")),
        fileUrl: s(formData.get("fileUrl")),
        issueNotes: s(formData.get("issueNotes")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok(`"${title}" v${row.version} uploaded`);
  } catch (e) {
    return fail(e);
  }
}
export async function setRamsStatus(id: string, status: string) {
  try {
    await write(async (tx, { user }) => {
      const r = await repo.setRamsStatus(tx, id, status, actorFrom(user));
      if (!r) throw new Error("RAMS not found");
      return r;
    });
    return ok("RAMS updated");
  } catch (e) {
    return fail(e);
  }
}
export async function deleteRams(id: string) {
  try {
    await write((tx) => repo.deleteRams(tx, id));
    return ok("RAMS removed");
  } catch (e) {
    return fail(e);
  }
}

// ── PPE ───────────────────────────────────────────────────────────────────────
export async function createPpe(prevState: unknown, formData: FormData) {
  const item = s(formData.get("item")).trim();
  if (!item) return { error: "Name the PPE item" };
  try {
    await write((tx, { user, companyId }) =>
      repo.createPpe(tx, {
        companyId,
        item,
        employeeName: s(formData.get("employeeName")),
        condition: s(formData.get("condition")) || "new",
        issuedAt: s(formData.get("issuedAt")),
        replacementDueAt: s(formData.get("replacementDueAt")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok(`${item} issued`);
  } catch (e) {
    return fail(e);
  }
}
export async function returnPpe(id: string) {
  try {
    await write((tx) => repo.returnPpe(tx, id));
    return ok("Marked returned");
  } catch (e) {
    return fail(e);
  }
}
export async function deletePpe(id: string) {
  try {
    await write((tx) => repo.deletePpe(tx, id));
    return ok("PPE record removed");
  } catch (e) {
    return fail(e);
  }
}

// ── Toolbox talks ─────────────────────────────────────────────────────────────
export async function createToolbox(prevState: unknown, formData: FormData) {
  const topic = s(formData.get("topic")).trim();
  if (!topic) return { error: "A toolbox talk needs a topic" };
  const count = parseInt(s(formData.get("attendeeCount")), 10);
  try {
    await write((tx, { user, companyId }) =>
      repo.createToolbox(tx, {
        companyId,
        topic,
        siteName: s(formData.get("siteName")),
        supervisorName: s(formData.get("supervisorName")),
        heldOn: s(formData.get("heldOn")),
        attendeeCount: Number.isFinite(count) ? count : 0,
        attendees: s(formData.get("attendees")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok("Toolbox talk recorded");
  } catch (e) {
    return fail(e);
  }
}
export async function deleteToolbox(id: string) {
  try {
    await write((tx) => repo.deleteToolbox(tx, id));
    return ok("Talk removed");
  } catch (e) {
    return fail(e);
  }
}

// ── Training ────────────────────────────────────────────────────────────────
export async function createTraining(prevState: unknown, formData: FormData) {
  const course = s(formData.get("course")).trim();
  if (!course) return { error: "Name the course" };
  try {
    await write((tx, { user, companyId }) =>
      repo.createTraining(tx, {
        companyId,
        course,
        employeeName: s(formData.get("employeeName")),
        completedOn: s(formData.get("completedOn")),
        expiresOn: s(formData.get("expiresOn")),
        certificateUrl: s(formData.get("certificateUrl")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok("Training record added");
  } catch (e) {
    return fail(e);
  }
}
export async function deleteTraining(id: string) {
  try {
    await write((tx) => repo.deleteTraining(tx, id));
    return ok("Record removed");
  } catch (e) {
    return fail(e);
  }
}

// ── Statutory inspections ─────────────────────────────────────────────────────
export async function createStatutory(prevState: unknown, formData: FormData) {
  const equipment = s(formData.get("equipment")).trim();
  if (!equipment) return { error: "Name the equipment" };
  try {
    await write((tx, { user, companyId }) =>
      repo.createStatutory(tx, {
        companyId,
        equipment,
        siteName: s(formData.get("siteName")),
        inspectorName: s(formData.get("inspectorName")),
        lastInspectedAt: s(formData.get("lastInspectedAt")),
        dueDate: s(formData.get("dueDate")),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    return ok("Inspection scheduled");
  } catch (e) {
    return fail(e);
  }
}
export async function setStatutoryStatus(id: string, status: string) {
  try {
    await write(async (tx, { user }) => {
      const r = await repo.setStatutoryStatus(tx, id, status, actorFrom(user));
      if (!r) throw new Error("Inspection not found");
      return r;
    });
    return ok("Inspection updated");
  } catch (e) {
    return fail(e);
  }
}
export async function deleteStatutory(id: string) {
  try {
    await write((tx) => repo.deleteStatutory(tx, id));
    return ok("Inspection removed");
  } catch (e) {
    return fail(e);
  }
}
