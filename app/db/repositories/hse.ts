import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  hseCorrectiveActions,
  hseIncidents,
  hsePpeIssues,
  hseRams,
  hseSites,
  hseStatutoryInspections,
  hseToolboxTalks,
  hseTrainingRecords,
} from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * HSE repository — 0090. Same contract as the other repositories: `tx` is
 * RLS-scoped, no session/role logic here (that is hse-actions.ts). Incident
 * numbers come from next_entry_number('HSE').
 */

/**
 * Assumed exposure hours for the rate formulas. TRIR/LTIF need hours worked,
 * which HSE doesn't yet capture; 200,000 is the OSHA convention (100 FTE ×
 * 2,000 h), so with this denominator TRIR reads as recordables per 100 FTE —
 * an honest, industry-standard illustration until HR feeds real hours in.
 */
const HOURS_WORKED = 200_000;

async function nextNumber(tx: Tx, companyId: string, prefix: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${prefix}) AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

const clean = (v?: string | null) => (v ?? "").trim();

// ── Sites ──────────────────────────────────────────────────────────────────
export function listSites(tx: Tx) {
  return tx.select().from(hseSites).orderBy(asc(hseSites.name));
}
export async function createSite(
  tx: Tx,
  input: { companyId: string; name: string; location?: string | null; projectId?: string | null; projectName?: string | null; createdById?: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(hseSites)
    .values({
      companyId: input.companyId,
      name: input.name.trim(),
      location: clean(input.location),
      projectId: input.projectId && isUuid(input.projectId) ? input.projectId : null,
      projectName: clean(input.projectName),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}
export async function deleteSite(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseSites).where(eq(hseSites.id, id));
}

// ── Incidents ─────────────────────────────────────────────────────────────────
export async function listIncidents(tx: Tx) {
  return (await tx.execute(sql`
    SELECT i.*, count(c.id)::int AS action_count,
           count(c.id) FILTER (WHERE c.status <> 'completed')::int AS open_action_count
      FROM hse_incidents i
      LEFT JOIN hse_corrective_actions c ON c.incident_id = i.id
     GROUP BY i.id
     ORDER BY i.occurred_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
}

export async function getIncidentById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(hseIncidents).where(eq(hseIncidents.id, id));
  return row ?? null;
}

export async function getIncidentActions(tx: Tx, incidentId: string) {
  if (!isUuid(incidentId)) return [];
  return tx
    .select()
    .from(hseCorrectiveActions)
    .where(eq(hseCorrectiveActions.incidentId, incidentId))
    .orderBy(asc(hseCorrectiveActions.dueDate));
}

export async function createIncident(
  tx: Tx,
  input: {
    companyId: string;
    siteId?: string | null;
    siteName?: string | null;
    type: string;
    severity: string;
    occurredAt?: string | null;
    reportedByName?: string | null;
    description?: string | null;
    isEnvironmental?: boolean;
    nemaRef?: string | null;
    nemaNotificationRequired?: boolean;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const incidentNumber = await nextNumber(tx, input.companyId, "HSE");
  const [row] = await tx
    .insert(hseIncidents)
    .values({
      companyId: input.companyId,
      incidentNumber,
      siteId: input.siteId && isUuid(input.siteId) ? input.siteId : null,
      siteName: clean(input.siteName),
      type: input.type,
      severity: input.severity,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      reportedByName: clean(input.reportedByName),
      description: clean(input.description),
      isEnvironmental: input.isEnvironmental ?? false,
      nemaRef: clean(input.nemaRef),
      nemaNotificationRequired: input.nemaNotificationRequired ?? false,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function setIncidentStatus(
  tx: Tx,
  id: string,
  status: string,
  actor: { id: string | null; name: string },
) {
  const [row] = await tx
    .update(hseIncidents)
    .set({ status, lastModifiedById: actor.id, lastModifiedByName: actor.name, updatedAt: new Date() })
    .where(eq(hseIncidents.id, id))
    .returning();
  return row ?? null;
}

export async function markNemaNotified(tx: Tx, id: string) {
  const [row] = await tx
    .update(hseIncidents)
    .set({ nemaNotifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(hseIncidents.id, id))
    .returning();
  return row ?? null;
}

export async function deleteIncident(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseIncidents).where(eq(hseIncidents.id, id));
}

// ── Corrective actions ────────────────────────────────────────────────────────
export async function createCorrectiveAction(
  tx: Tx,
  input: { companyId: string; incidentId: string; description: string; ownerName?: string | null; dueDate?: string | null; createdById?: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(hseCorrectiveActions)
    .values({
      companyId: input.companyId,
      incidentId: input.incidentId,
      description: input.description.trim(),
      ownerName: clean(input.ownerName),
      dueDate: input.dueDate || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  // Opening an action on an Open incident advances it to action-pending.
  await tx
    .update(hseIncidents)
    .set({ status: "corrective_action_pending", updatedAt: new Date() })
    .where(and(eq(hseIncidents.id, input.incidentId), eq(hseIncidents.status, "open")));
  return row;
}

export async function setCorrectiveActionStatus(
  tx: Tx,
  id: string,
  status: string,
  actor: { id: string | null; name: string },
) {
  const [row] = await tx
    .update(hseCorrectiveActions)
    .set({
      status,
      closedAt: status === "completed" ? new Date() : null,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(hseCorrectiveActions.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCorrectiveAction(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseCorrectiveActions).where(eq(hseCorrectiveActions.id, id));
}

// ── RAMS ────────────────────────────────────────────────────────────────────
export function listRams(tx: Tx) {
  return tx.select().from(hseRams).orderBy(desc(hseRams.updatedAt));
}
export async function createRams(
  tx: Tx,
  input: { companyId: string; siteId?: string | null; siteName?: string | null; subcontractorName?: string | null; title: string; fileUrl?: string | null; issueNotes?: string | null; createdById?: string | null; createdByName: string },
) {
  // Each revision is its own row; version increments per (siteName + title).
  const [{ v }] = (await tx.execute(sql`
    SELECT COALESCE(max(version), 0) + 1 AS v FROM hse_rams
     WHERE title = ${input.title.trim()} AND site_name = ${clean(input.siteName)}
  `)) as unknown as Array<{ v: number }>;
  const [row] = await tx
    .insert(hseRams)
    .values({
      companyId: input.companyId,
      siteId: input.siteId && isUuid(input.siteId) ? input.siteId : null,
      siteName: clean(input.siteName),
      subcontractorName: clean(input.subcontractorName),
      title: input.title.trim(),
      version: v,
      fileUrl: clean(input.fileUrl),
      issueNotes: clean(input.issueNotes),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}
export async function setRamsStatus(
  tx: Tx,
  id: string,
  status: string,
  actor: { id: string | null; name: string },
) {
  const [row] = await tx
    .update(hseRams)
    .set({
      status,
      reviewedAt: ["approved", "rejected", "under_review"].includes(status) ? new Date() : null,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(hseRams.id, id))
    .returning();
  return row ?? null;
}
export async function deleteRams(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseRams).where(eq(hseRams.id, id));
}

// ── PPE ───────────────────────────────────────────────────────────────────────
export function listPpe(tx: Tx) {
  return tx.select().from(hsePpeIssues).orderBy(desc(hsePpeIssues.issuedAt));
}
export async function createPpe(
  tx: Tx,
  input: { companyId: string; employeeName?: string | null; item: string; condition?: string; issuedAt?: string | null; replacementDueAt?: string | null; createdById?: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(hsePpeIssues)
    .values({
      companyId: input.companyId,
      employeeName: clean(input.employeeName),
      item: input.item.trim(),
      condition: input.condition || "new",
      issuedAt: input.issuedAt || null,
      replacementDueAt: input.replacementDueAt || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}
export async function returnPpe(tx: Tx, id: string) {
  const [row] = await tx
    .update(hsePpeIssues)
    .set({ returnedAt: sql`now()::date`, updatedAt: new Date() })
    .where(eq(hsePpeIssues.id, id))
    .returning();
  return row ?? null;
}
export async function deletePpe(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hsePpeIssues).where(eq(hsePpeIssues.id, id));
}

// ── Toolbox talks ─────────────────────────────────────────────────────────────
export function listToolbox(tx: Tx) {
  return tx.select().from(hseToolboxTalks).orderBy(desc(hseToolboxTalks.heldOn));
}
export async function createToolbox(
  tx: Tx,
  input: { companyId: string; siteId?: string | null; siteName?: string | null; supervisorName?: string | null; topic: string; heldOn?: string | null; attendeeCount?: number; attendees?: string | null; createdById?: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(hseToolboxTalks)
    .values({
      companyId: input.companyId,
      siteId: input.siteId && isUuid(input.siteId) ? input.siteId : null,
      siteName: clean(input.siteName),
      supervisorName: clean(input.supervisorName),
      topic: input.topic.trim(),
      heldOn: input.heldOn || null,
      attendeeCount: Number.isFinite(input.attendeeCount) ? Number(input.attendeeCount) : 0,
      attendees: clean(input.attendees),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}
export async function deleteToolbox(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseToolboxTalks).where(eq(hseToolboxTalks.id, id));
}

// ── Training ────────────────────────────────────────────────────────────────
export function listTraining(tx: Tx) {
  return tx.select().from(hseTrainingRecords).orderBy(asc(hseTrainingRecords.expiresOn));
}
export async function createTraining(
  tx: Tx,
  input: { companyId: string; employeeName?: string | null; course: string; completedOn?: string | null; expiresOn?: string | null; certificateUrl?: string | null; createdById?: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(hseTrainingRecords)
    .values({
      companyId: input.companyId,
      employeeName: clean(input.employeeName),
      course: input.course.trim(),
      completedOn: input.completedOn || null,
      expiresOn: input.expiresOn || null,
      certificateUrl: clean(input.certificateUrl),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}
export async function deleteTraining(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseTrainingRecords).where(eq(hseTrainingRecords.id, id));
}

// ── Statutory inspections ─────────────────────────────────────────────────────
export function listStatutory(tx: Tx) {
  return tx.select().from(hseStatutoryInspections).orderBy(asc(hseStatutoryInspections.dueDate));
}
export async function createStatutory(
  tx: Tx,
  input: { companyId: string; siteId?: string | null; siteName?: string | null; equipment: string; inspectorName?: string | null; lastInspectedAt?: string | null; dueDate?: string | null; createdById?: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(hseStatutoryInspections)
    .values({
      companyId: input.companyId,
      siteId: input.siteId && isUuid(input.siteId) ? input.siteId : null,
      siteName: clean(input.siteName),
      equipment: input.equipment.trim(),
      inspectorName: clean(input.inspectorName),
      lastInspectedAt: input.lastInspectedAt || null,
      dueDate: input.dueDate || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}
export async function setStatutoryStatus(
  tx: Tx,
  id: string,
  status: string,
  actor: { id: string | null; name: string },
) {
  const [row] = await tx
    .update(hseStatutoryInspections)
    .set({
      status,
      lastInspectedAt: status === "passed" || status === "failed" ? sql`now()::date` : undefined,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(hseStatutoryInspections.id, id))
    .returning();
  return row ?? null;
}
export async function deleteStatutory(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(hseStatutoryInspections).where(eq(hseStatutoryInspections.id, id));
}

// ── Dashboard (HSE-008): TRIR, LTIF, near-miss, open CAs, RAMS, training, insp)
export async function getHseDashboard(tx: Tx) {
  const [inc] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE occurred_at >= date_trunc('year', now()))::int AS total_ytd,
      count(*) FILTER (WHERE type = 'near_miss' AND occurred_at >= date_trunc('year', now()))::int AS near_miss,
      count(*) FILTER (WHERE type IN ('medical_treatment','lost_time_injury') AND occurred_at >= date_trunc('year', now()))::int AS recordable,
      count(*) FILTER (WHERE type = 'lost_time_injury' AND occurred_at >= date_trunc('year', now()))::int AS lti,
      count(*) FILTER (WHERE status <> 'closed')::int AS open_incidents,
      count(*) FILTER (WHERE is_environmental AND nema_notification_required AND nema_notified_at IS NULL)::int AS nema_pending,
      max(occurred_at) FILTER (WHERE type = 'lost_time_injury') AS last_lti
    FROM hse_incidents
  `)) as unknown as Array<Record<string, number | string | null>>;

  const [ca] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open_actions,
      count(*) FILTER (WHERE status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date < now()::date)::int AS overdue_actions
    FROM hse_corrective_actions
  `)) as unknown as Array<Record<string, number>>;

  const [rams] = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE status IN ('submitted','under_review'))::int AS pending
    FROM hse_rams
  `)) as unknown as Array<Record<string, number>>;

  const [tr] = (await tx.execute(sql`
    SELECT count(*) FILTER (
      WHERE expires_on IS NOT NULL AND expires_on <= (now() + interval '60 days')::date
    )::int AS expiring
    FROM hse_training_records
  `)) as unknown as Array<Record<string, number>>;

  const [ins] = (await tx.execute(sql`
    SELECT count(*) FILTER (
      WHERE status = 'scheduled' AND due_date IS NOT NULL AND due_date <= (now() + interval '30 days')::date
    )::int AS due_soon,
    count(*) FILTER (WHERE status = 'overdue' OR (status = 'scheduled' AND due_date < now()::date))::int AS overdue
    FROM hse_statutory_inspections
  `)) as unknown as Array<Record<string, number>>;

  const recordable = Number(inc?.recordable ?? 0);
  const lti = Number(inc?.lti ?? 0);
  const lastLti = inc?.last_lti ? new Date(inc.last_lti as string) : null;
  const daysSinceLti = lastLti ? Math.floor((Date.now() - lastLti.getTime()) / 86_400_000) : null;

  return {
    trir: Number(((recordable * 200_000) / HOURS_WORKED).toFixed(2)),
    ltif: Number(((lti * 1_000_000) / HOURS_WORKED).toFixed(2)),
    nearMiss: Number(inc?.near_miss ?? 0),
    totalYtd: Number(inc?.total_ytd ?? 0),
    recordable,
    lti,
    openIncidents: Number(inc?.open_incidents ?? 0),
    nemaPending: Number(inc?.nema_pending ?? 0),
    openActions: Number(ca?.open_actions ?? 0),
    overdueActions: Number(ca?.overdue_actions ?? 0),
    ramsPending: Number(rams?.pending ?? 0),
    trainingExpiring: Number(tr?.expiring ?? 0),
    inspectionsDue: Number(ins?.due_soon ?? 0),
    inspectionsOverdue: Number(ins?.overdue ?? 0),
    daysSinceLti,
  };
}
