import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { complianceCertificates, complianceObligations, complianceTasks } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Compliance repository — 0116. `tx` is already RLS-scoped; no companyId
 * filtering, no session/role logic (that is compliance-actions.ts). A
 * certificate's current/expiring/expired state and the "days left" are DERIVED
 * from the expiry date, never stored.
 */

type Actor = { id?: string | null; name?: string | null };

// ── Certificates ────────────────────────────────────────────────────────────────
export function listCertificates(tx: Tx) {
  return tx.select().from(complianceCertificates).orderBy(asc(complianceCertificates.expiryDate));
}

export async function createCertificate(
  tx: Tx,
  input: {
    companyId: string;
    name: string;
    responsibleUserId?: string | null;
    responsibleName?: string | null;
    reference?: string | null;
    issueDate?: string | null;
    expiryDate?: string | null;
    notes?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(complianceCertificates)
    .values({
      companyId: input.companyId,
      name: input.name.trim(),
      responsibleUserId: input.responsibleUserId || null,
      responsibleName: input.responsibleName?.trim() ?? "",
      reference: input.reference?.trim() ?? "",
      issueDate: input.issueDate || null,
      expiryDate: input.expiryDate || null,
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateCertificate(tx: Tx, id: string, patch: Record<string, unknown>, actor: Actor) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of ["name", "responsibleUserId", "responsibleName", "reference", "issueDate", "expiryDate", "notes"]) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" && (k === "issueDate" || k === "expiryDate" || k === "responsibleUserId") ? null : patch[k];
  }
  const [row] = await tx.update(complianceCertificates).set(set).where(eq(complianceCertificates.id, id)).returning();
  return row ?? null;
}

export async function deleteCertificate(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(complianceCertificates).where(eq(complianceCertificates.id, id)).returning({ id: complianceCertificates.id });
  return rows.length > 0;
}

// ── Obligations ────────────────────────────────────────────────────────────────
export function listObligations(tx: Tx) {
  return tx.select().from(complianceObligations).orderBy(asc(complianceObligations.nextDue));
}

export async function createObligation(
  tx: Tx,
  input: {
    companyId: string;
    name: string;
    agency?: string | null;
    nextDue?: string | null;
    frequency?: string;
    penalty?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(complianceObligations)
    .values({
      companyId: input.companyId,
      name: input.name.trim(),
      agency: input.agency?.trim() ?? "",
      nextDue: input.nextDue || null,
      frequency: input.frequency ?? "monthly",
      penalty: input.penalty?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateObligation(tx: Tx, id: string, patch: Record<string, unknown>, actor: Actor) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of ["name", "agency", "nextDue", "frequency", "penalty"]) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" && k === "nextDue" ? null : patch[k];
  }
  const [row] = await tx.update(complianceObligations).set(set).where(eq(complianceObligations.id, id)).returning();
  return row ?? null;
}

export async function deleteObligation(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(complianceObligations).where(eq(complianceObligations.id, id)).returning({ id: complianceObligations.id });
  return rows.length > 0;
}

// ── Tasks ────────────────────────────────────────────────────────────────────
export function listTasks(tx: Tx) {
  return tx.select().from(complianceTasks).orderBy(asc(complianceTasks.dueDate));
}

export async function createTask(
  tx: Tx,
  input: {
    companyId: string;
    title: string;
    assignedUserId?: string | null;
    assignedName?: string | null;
    dueDate?: string | null;
    status?: string;
    certificateId?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(complianceTasks)
    .values({
      companyId: input.companyId,
      title: input.title.trim(),
      assignedUserId: input.assignedUserId || null,
      assignedName: input.assignedName?.trim() ?? "",
      dueDate: input.dueDate || null,
      status: input.status ?? "open",
      certificateId: input.certificateId || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function setTaskStatus(tx: Tx, id: string, status: string, actor: Actor) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(complianceTasks)
    .set({
      status,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(complianceTasks.id, id))
    .returning();
  return row ?? null;
}

export async function deleteTask(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(complianceTasks).where(eq(complianceTasks.id, id)).returning({ id: complianceTasks.id });
  return rows.length > 0;
}

// ── Stats (derived) ──────────────────────────────────────────────────────────
export async function getComplianceStats(tx: Tx) {
  const [c] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE expiry_date IS NULL OR expiry_date > CURRENT_DATE + interval '60 days')::int AS current,
      count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > CURRENT_DATE AND expiry_date <= CURRENT_DATE + interval '60 days')::int AS expiring,
      count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE)::int AS expired
    FROM compliance_certificates
  `)) as unknown as Array<{ total: number; current: number; expiring: number; expired: number }>;
  const [t] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status <> 'done')::int AS open,
      count(*) FILTER (WHERE status <> 'done' AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue
    FROM compliance_tasks
  `)) as unknown as Array<{ open: number; overdue: number }>;
  return {
    certificates: c?.total ?? 0,
    current: c?.current ?? 0,
    expiring: c?.expiring ?? 0,
    expired: c?.expired ?? 0,
    openTasks: t?.open ?? 0,
    overdueTasks: t?.overdue ?? 0,
  };
}
