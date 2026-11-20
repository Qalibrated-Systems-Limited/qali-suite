import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { calibrationJobs, calibrationStandards, inspections } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Technical department repository — Calibration (17025) & Inspection (17020),
 * 0079. Same contract as the other repositories: `tx` is RLS-scoped, no session
 * or role logic here — that lives in `technical-actions.ts`.
 */

async function nextNumber(tx: Tx, companyId: string, prefix: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${prefix}) AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

// ── Calibration: reference standards ─────────────────────────────────────────
export function listStandards(tx: Tx) {
  return tx
    .select()
    .from(calibrationStandards)
    .orderBy(desc(calibrationStandards.nextCalibration));
}

export interface CreateStandardInput {
  companyId: string;
  name: string;
  traceability?: string | null;
  lastCalibration?: string | null;
  nextCalibration?: string | null;
  uncertainty?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdByName: string;
}

export async function createStandard(tx: Tx, input: CreateStandardInput) {
  const [row] = await tx
    .insert(calibrationStandards)
    .values({
      companyId: input.companyId,
      name: input.name.trim(),
      traceability: input.traceability?.trim() ?? "",
      lastCalibration: input.lastCalibration || null,
      nextCalibration: input.nextCalibration || null,
      uncertainty: input.uncertainty?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function deleteStandard(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(calibrationStandards).where(eq(calibrationStandards.id, id));
}

// ── Calibration: jobs ────────────────────────────────────────────────────────
export function listJobs(tx: Tx) {
  return tx.select().from(calibrationJobs).orderBy(desc(calibrationJobs.createdAt));
}

export async function getJobById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(calibrationJobs).where(eq(calibrationJobs.id, id));
  return row ?? null;
}

export interface CreateJobInput {
  companyId: string;
  projectId?: string | null;
  clientName: string;
  site?: string | null;
  serviceType?: string | null;
  scheduledDate?: string | null;
  technicianName?: string | null;
  technicianId?: string | null;
  status?: string;
  notes?: string | null;
  createdById?: string | null;
  createdByName: string;
}

export async function createJob(tx: Tx, input: CreateJobInput) {
  const jobNumber = await nextNumber(tx, input.companyId, "JOB");
  const [row] = await tx
    .insert(calibrationJobs)
    .values({
      companyId: input.companyId,
      projectId: input.projectId || null,
      jobNumber,
      clientName: input.clientName.trim(),
      site: input.site?.trim() ?? "",
      serviceType: input.serviceType?.trim() ?? "",
      scheduledDate: input.scheduledDate || null,
      technicianName: input.technicianName?.trim() ?? "",
      technicianId: input.technicianId || null,
      status: input.status || "scheduled",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

/**
 * Advance a job's status. Completing a PASSED job issues its certificate
 * number if it has none yet — that is what turns a job into a certificate.
 */
export async function setJobOutcome(
  tx: Tx,
  id: string,
  input: { status?: string; result?: string; billingStatus?: string },
  actor: { id: string | null; name: string },
) {
  const existing = await getJobById(tx, id);
  if (!existing) return null;

  const status = input.status ?? existing.status;
  const result = input.result ?? existing.result;
  // Certificates are issued on approval (approveWork), not here.
  const certNumber = existing.certNumber;

  const [row] = await tx
    .update(calibrationJobs)
    .set({
      status,
      result,
      ...(input.billingStatus !== undefined && { billingStatus: input.billingStatus }),
      certNumber,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(calibrationJobs.id, id))
    .returning();
  return row ?? null;
}

export async function deleteJob(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(calibrationJobs).where(eq(calibrationJobs.id, id));
}

export async function getCalibrationStats(tx: Tx) {
  const [jobs] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE cert_number <> '')::int AS certs,
      count(*) FILTER (WHERE result = 'passed')::int AS passed,
      count(*) FILTER (WHERE result = 'failed')::int AS failed,
      count(*) FILTER (WHERE status IN ('scheduled','in_progress','returned'))::int AS open_jobs,
      count(*) FILTER (WHERE status = 'submitted')::int AS awaiting_approval
    FROM calibration_jobs
  `)) as unknown as Array<Record<string, number>>;
  const [std] = (await tx.execute(sql`
    SELECT
      count(*)::int AS standards,
      count(*) FILTER (
        WHERE next_calibration IS NOT NULL
          AND next_calibration <= (now() + interval '60 days')::date
      )::int AS expiring
    FROM calibration_standards
  `)) as unknown as Array<Record<string, number>>;
  return {
    total: jobs?.total ?? 0,
    certs: jobs?.certs ?? 0,
    passed: jobs?.passed ?? 0,
    failed: jobs?.failed ?? 0,
    openJobs: jobs?.open_jobs ?? 0,
    awaitingApproval: jobs?.awaiting_approval ?? 0,
    standards: std?.standards ?? 0,
    expiring: std?.expiring ?? 0,
  };
}

// ── Inspection (17020) ───────────────────────────────────────────────────────
export function listInspections(tx: Tx) {
  return tx.select().from(inspections).orderBy(desc(inspections.createdAt));
}

export async function getInspectionById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(inspections).where(eq(inspections.id, id));
  return row ?? null;
}

export interface CreateInspectionInput {
  companyId: string;
  projectId?: string | null;
  type?: string | null;
  equipmentSerial?: string | null;
  clientName: string;
  inspectorName?: string | null;
  inspectorId?: string | null;
  scheduledDate?: string | null;
  ruling?: string;
  authorityExpiry?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdByName: string;
}

export async function createInspection(tx: Tx, input: CreateInspectionInput) {
  const inspectionNumber = await nextNumber(tx, input.companyId, "INS");
  const [row] = await tx
    .insert(inspections)
    .values({
      companyId: input.companyId,
      projectId: input.projectId || null,
      inspectionNumber,
      type: input.type?.trim() ?? "",
      equipmentSerial: input.equipmentSerial?.trim() ?? "",
      clientName: input.clientName.trim(),
      inspectorName: input.inspectorName?.trim() ?? "",
      inspectorId: input.inspectorId || null,
      scheduledDate: input.scheduledDate || null,
      ruling: input.ruling || "pending",
      authorityExpiry: input.authorityExpiry || null,
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function setInspectionOutcome(
  tx: Tx,
  id: string,
  input: { ruling?: string; appealStatus?: string },
  actor: { id: string | null; name: string },
) {
  const [row] = await tx
    .update(inspections)
    .set({
      ...(input.ruling !== undefined && { ruling: input.ruling }),
      ...(input.appealStatus !== undefined && { appealStatus: input.appealStatus }),
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(inspections.id, id))
    .returning();
  return row ?? null;
}

export async function deleteInspection(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(inspections).where(eq(inspections.id, id));
}

/** Distinct inspectors with their inspection counts — for the Inspectors tab. */
export async function listInspectors(tx: Tx) {
  return (await tx.execute(sql`
    SELECT inspector_name AS name,
           count(*)::int AS total,
           count(*) FILTER (WHERE ruling = 'pass')::int AS passed,
           count(*) FILTER (WHERE ruling = 'fail')::int AS failed
    FROM inspections
    WHERE btrim(inspector_name) <> ''
    GROUP BY inspector_name
    ORDER BY total DESC
  `)) as unknown as Array<{ name: string; total: number; passed: number; failed: number }>;
}

export async function getInspectionStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('scheduled','in_progress','returned'))::int AS open_inspections,
      count(*) FILTER (WHERE status = 'submitted')::int AS awaiting_approval,
      count(*) FILTER (WHERE ruling IN ('fail','quarantined'))::int AS failed_quarantined,
      count(*) FILTER (WHERE appeal_status = 'open')::int AS open_appeals,
      count(*) FILTER (
        WHERE authority_expiry IS NOT NULL
          AND authority_expiry <= (now() + interval '30 days')::date
      )::int AS auth_expiring
    FROM inspections
  `)) as unknown as Array<Record<string, number>>;
  return {
    total: row?.total ?? 0,
    openInspections: row?.open_inspections ?? 0,
    awaitingApproval: row?.awaiting_approval ?? 0,
    failedQuarantined: row?.failed_quarantined ?? 0,
    openAppeals: row?.open_appeals ?? 0,
    authExpiring: row?.auth_expiring ?? 0,
  };
}

// ── Assigned work and its sign-off (calibration jobs & inspections) ──────────
//
// scheduled → in_progress → submitted → approved, or submitted → returned →
// (fixed) → submitted again. The technician records the result and submits;
// someone else approves it. A calibration certificate number is issued on
// APPROVAL of a passed job, not when the technician types "passed" — an
// unauthorised result is not a certificate.

export type WorkKind = "job" | "inspection";
type Person = { id: string | null; name: string };

const OPEN = ["scheduled", "in_progress", "returned"];

function table(kind: WorkKind) {
  return kind === "job" ? calibrationJobs : inspections;
}

export async function getWork(tx: Tx, kind: WorkKind, id: string) {
  return kind === "job" ? getJobById(tx, id) : getInspectionById(tx, id);
}

/** Who does the work on this item (user id), whichever table it is in. */
export function assigneeOf(kind: WorkKind, row: Record<string, unknown>): string | null {
  const v = kind === "job" ? row.technicianId : row.inspectorId;
  return v ? String(v) : null;
}

async function patch(tx: Tx, kind: WorkKind, id: string, set: Record<string, unknown>, actor: Person) {
  const t = table(kind);
  const [row] = await tx
    .update(t)
    .set({ ...set, lastModifiedById: actor.id, lastModifiedByName: actor.name, updatedAt: new Date() })
    .where(eq(t.id, id))
    .returning();
  return row ?? null;
}

/** Give the work to a person (or take it back: `to` null). */
export async function assignWork(tx: Tx, kind: WorkKind, id: string, to: Person | null, actor: Person) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (current.status === "approved") throw new Error("Approved work cannot be reassigned.");
  return patch(
    tx,
    kind,
    id,
    kind === "job"
      ? { technicianId: to?.id ?? null, technicianName: to?.name ?? "" }
      : { inspectorId: to?.id ?? null, inspectorName: to?.name ?? "" },
    actor,
  );
}

export async function startWork(tx: Tx, kind: WorkKind, id: string, actor: Person) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (!["scheduled", "returned"].includes(current.status)) {
    throw new Error("Only scheduled or returned work can be started.");
  }
  return patch(tx, kind, id, { status: "in_progress" }, actor);
}

/**
 * The technician records the outcome and hands it over for approval.
 * Job: result passed|failed. Inspection: ruling pass|fail|quarantined.
 */
export async function submitWork(
  tx: Tx,
  kind: WorkKind,
  id: string,
  outcome: { result?: string; ruling?: string; notes?: string },
  actor: Person,
) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (!OPEN.includes(current.status)) {
    throw new Error("This work has already been submitted.");
  }
  const set: Record<string, unknown> = {
    status: "submitted",
    submittedAt: new Date(),
    returnComment: "",
    ...(outcome.notes !== undefined && { notes: outcome.notes.trim() }),
  };
  if (kind === "job") {
    if (!["passed", "failed"].includes(outcome.result ?? "")) {
      throw new Error("Record whether the item passed or failed before submitting.");
    }
    set.result = outcome.result;
  } else {
    if (!["pass", "fail", "quarantined"].includes(outcome.ruling ?? "")) {
      throw new Error("Record the ruling (pass, fail or quarantined) before submitting.");
    }
    set.ruling = outcome.ruling;
  }
  // Whoever submits is the one who did the work, if nobody was named.
  if (!assigneeOf(kind, current as Record<string, unknown>) && actor.id) {
    Object.assign(
      set,
      kind === "job"
        ? { technicianId: actor.id, technicianName: actor.name }
        : { inspectorId: actor.id, inspectorName: actor.name },
    );
  }
  return patch(tx, kind, id, set, actor);
}

export async function approveWork(tx: Tx, kind: WorkKind, id: string, actor: Person) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (current.status !== "submitted") throw new Error("Only submitted work can be approved.");
  if (actor.id && assigneeOf(kind, current as Record<string, unknown>) === actor.id) {
    throw new Error("You cannot approve work you carried out yourself — another manager must.");
  }
  const set: Record<string, unknown> = {
    status: "approved",
    approvedById: actor.id,
    approvedByName: actor.name,
    approvedAt: new Date(),
  };
  if (kind === "job") {
    const job = current as typeof calibrationJobs.$inferSelect;
    if (job.result === "passed" && !job.certNumber) {
      set.certNumber = await nextNumber(tx, job.companyId, "CERT");
    }
  }
  return patch(tx, kind, id, set, actor);
}

export async function returnWork(tx: Tx, kind: WorkKind, id: string, comment: string, actor: Person) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (current.status !== "submitted") throw new Error("Only submitted work can be returned.");
  if (!comment.trim()) throw new Error("Say what needs fixing so the technician knows.");
  return patch(tx, kind, id, { status: "returned", returnComment: comment.trim() }, actor);
}

/** Back from approved to submitted, e.g. a certificate issued in error. */
export async function reopenWork(tx: Tx, kind: WorkKind, id: string, actor: Person) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (current.status !== "approved") throw new Error("Only approved work can be reopened.");
  return patch(
    tx,
    kind,
    id,
    { status: "submitted", approvedById: null, approvedByName: null, approvedAt: null },
    actor,
  );
}

export async function cancelWork(tx: Tx, kind: WorkKind, id: string, actor: Person) {
  const current = await getWork(tx, kind, id);
  if (!current) return null;
  if (current.status === "approved") throw new Error("Approved work cannot be cancelled.");
  return patch(tx, kind, id, { status: "cancelled" }, actor);
}

/**
 * Everything the "My work" page shows, in one round trip per list.
 * `userId` is the viewer; `isManager` adds the approval queue and the team.
 */
export async function getMyWork(tx: Tx, userId: string, isManager: boolean) {
  const mineJobs = await tx
    .select()
    .from(calibrationJobs)
    .where(and(eq(calibrationJobs.technicianId, userId), sql`${calibrationJobs.status} IN ('scheduled','in_progress','returned','submitted')`))
    .orderBy(calibrationJobs.scheduledDate);
  const mineInspections = await tx
    .select()
    .from(inspections)
    .where(and(eq(inspections.inspectorId, userId), sql`${inspections.status} IN ('scheduled','in_progress','returned','submitted')`))
    .orderBy(inspections.scheduledDate);

  let approvalJobs: (typeof calibrationJobs.$inferSelect)[] = [];
  let approvalInspections: (typeof inspections.$inferSelect)[] = [];
  let unassigned = { jobs: 0, inspections: 0 };
  let team: Array<{ id: string; name: string; open: number; submitted: number; overdue: number }> = [];
  if (isManager) {
    approvalJobs = await tx
      .select()
      .from(calibrationJobs)
      .where(eq(calibrationJobs.status, "submitted"))
      .orderBy(calibrationJobs.submittedAt);
    approvalInspections = await tx
      .select()
      .from(inspections)
      .where(eq(inspections.status, "submitted"))
      .orderBy(inspections.submittedAt);
    const [u] = (await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM calibration_jobs WHERE technician_id IS NULL AND status IN ('scheduled','in_progress')) AS jobs,
        (SELECT count(*)::int FROM inspections WHERE inspector_id IS NULL AND status IN ('scheduled','in_progress')) AS inspections
    `)) as unknown as Array<{ jobs: number; inspections: number }>;
    unassigned = { jobs: u?.jobs ?? 0, inspections: u?.inspections ?? 0 };
    team = (await tx.execute(sql`
      WITH work AS (
        SELECT technician_id AS uid, technician_name AS name, status, scheduled_date FROM calibration_jobs WHERE technician_id IS NOT NULL
        UNION ALL
        SELECT inspector_id, inspector_name, status, scheduled_date FROM inspections WHERE inspector_id IS NOT NULL
      )
      SELECT uid AS id, max(name) AS name,
             count(*) FILTER (WHERE status IN ('scheduled','in_progress','returned'))::int AS open,
             count(*) FILTER (WHERE status = 'submitted')::int AS submitted,
             count(*) FILTER (WHERE status IN ('scheduled','in_progress','returned') AND scheduled_date < current_date)::int AS overdue
        FROM work
       GROUP BY uid
       ORDER BY open DESC, name
    `)) as unknown as typeof team;
  }
  return {
    jobs: mineJobs,
    inspections: mineInspections,
    approvalJobs,
    approvalInspections,
    unassigned,
    team,
  };
}
