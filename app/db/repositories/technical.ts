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
  let certNumber = existing.certNumber;
  if (status === "completed" && result === "passed" && !certNumber) {
    certNumber = await nextNumber(tx, existing.companyId, "CERT");
  }

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
      count(*) FILTER (WHERE status IN ('scheduled','in_progress'))::int AS open_jobs
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
      count(*) FILTER (WHERE ruling IN ('pending'))::int AS open_inspections,
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
    failedQuarantined: row?.failed_quarantined ?? 0,
    openAppeals: row?.open_appeals ?? 0,
    authExpiring: row?.auth_expiring ?? 0,
  };
}
