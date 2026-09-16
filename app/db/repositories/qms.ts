import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { qmsNonconformances, qmsCapas, qmsAudits, qmsManagementReviews } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * QMS repository — 0114. `tx` is already RLS-scoped; no companyId filtering, no
 * session/role logic (that is qms-actions.ts). Stats — open NCs, overdue CAPA
 * actions, CAPAs awaiting an effectiveness check, planned audits — are DERIVED
 * from status + dates, never stored.
 */

type Actor = { id?: string | null; name?: string | null };

async function nextNumber(tx: Tx, companyId: string, prefix: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${prefix}) AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

// ── Non-conformances (+ their CAPAs, joined for display) ────────────────────────
export async function listNonconformances(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT nc.*,
           c.id            AS capa_id,
           c.capa_number   AS capa_number,
           c.status        AS capa_status,
           c.due_date      AS capa_due_date,
           c.effectiveness_result AS capa_effectiveness
      FROM qms_nonconformances nc
      LEFT JOIN LATERAL (
        SELECT * FROM qms_capas x WHERE x.nonconformance_id = nc.id
        ORDER BY x.created_at DESC LIMIT 1
      ) c ON true
     ORDER BY nc.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    _id: String(r.id),
    ncNumber: String(r.nc_number ?? ""),
    source: String(r.source ?? ""),
    category: String(r.category ?? ""),
    title: String(r.title ?? ""),
    description: String(r.description ?? ""),
    isoClause: String(r.iso_clause ?? ""),
    severity: String(r.severity ?? ""),
    status: String(r.status ?? ""),
    ownerName: String(r.owner_name ?? ""),
    dueDate: r.due_date ? new Date(r.due_date as string).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    capa: r.capa_id
      ? {
          id: String(r.capa_id),
          capaNumber: String(r.capa_number ?? ""),
          status: String(r.capa_status ?? ""),
          dueDate: r.capa_due_date ? new Date(r.capa_due_date as string).toISOString() : null,
          effectiveness: String(r.capa_effectiveness ?? ""),
        }
      : null,
  }));
}

export async function createNonconformance(
  tx: Tx,
  input: {
    companyId: string;
    title: string;
    source?: string;
    category?: string;
    description?: string | null;
    isoClause?: string | null;
    severity?: string;
    ownerUserId?: string | null;
    ownerName?: string | null;
    dueDate?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const ncNumber = await nextNumber(tx, input.companyId, "NC");
  const [row] = await tx
    .insert(qmsNonconformances)
    .values({
      companyId: input.companyId,
      ncNumber,
      title: input.title.trim(),
      source: input.source ?? "internal_audit",
      category: input.category ?? "process",
      description: input.description?.trim() ?? "",
      isoClause: input.isoClause?.trim() ?? "",
      severity: input.severity ?? "minor",
      ownerUserId: input.ownerUserId || null,
      ownerName: input.ownerName?.trim() ?? "",
      dueDate: input.dueDate || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function setNcStatus(tx: Tx, id: string, status: string, actor: Actor) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(qmsNonconformances)
    .set({
      status,
      closedAt: status === "closed" ? new Date() : null,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(qmsNonconformances.id, id))
    .returning();
  return row ?? null;
}

export async function deleteNc(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(qmsNonconformances).where(eq(qmsNonconformances.id, id)).returning({ id: qmsNonconformances.id });
  return rows.length > 0;
}

// ── CAPA ────────────────────────────────────────────────────────────────────────
/**
 * Raise (or update) the CAPA that answers an NC. Creating one moves the NC to
 * `capa_in_progress`; verifying an effective CAPA closes the NC. This is the
 * lifecycle a QMS actually enforces.
 */
export async function upsertCapa(
  tx: Tx,
  input: {
    companyId: string;
    nonconformanceId: string;
    capaId?: string | null;
    type?: string;
    action?: string | null;
    ownerUserId?: string | null;
    ownerName?: string | null;
    dueDate?: string | null;
    status?: string;
    effectivenessDue?: string | null;
    effectivenessResult?: string;
    actor: Actor;
  },
) {
  if (!isUuid(input.nonconformanceId)) return null;
  const now = new Date();
  const completing = input.status === "completed" || input.status === "verified";
  const verifying = input.status === "verified";

  let capa;
  if (input.capaId && isUuid(input.capaId)) {
    [capa] = await tx
      .update(qmsCapas)
      .set({
        type: input.type ?? "corrective",
        action: input.action?.trim() ?? "",
        ownerUserId: input.ownerUserId || null,
        ownerName: input.ownerName?.trim() ?? "",
        dueDate: input.dueDate || null,
        status: input.status ?? "open",
        completedAt: completing ? now : null,
        effectivenessDue: input.effectivenessDue || null,
        effectivenessResult: input.effectivenessResult ?? "pending",
        verifiedAt: verifying ? now : null,
        verifiedByName: verifying ? input.actor?.name || "System" : "",
        lastModifiedById: input.actor?.id ?? null,
        lastModifiedByName: input.actor?.name || "System",
        updatedAt: now,
      })
      .where(eq(qmsCapas.id, input.capaId))
      .returning();
  } else {
    const capaNumber = await nextNumber(tx, input.companyId, "CAPA");
    [capa] = await tx
      .insert(qmsCapas)
      .values({
        companyId: input.companyId,
        capaNumber,
        nonconformanceId: input.nonconformanceId,
        type: input.type ?? "corrective",
        action: input.action?.trim() ?? "",
        ownerUserId: input.ownerUserId || null,
        ownerName: input.ownerName?.trim() ?? "",
        dueDate: input.dueDate || null,
        status: input.status ?? "open",
        effectivenessDue: input.effectivenessDue || null,
        effectivenessResult: input.effectivenessResult ?? "pending",
        createdById: input.actor?.id ?? null,
        createdByName: input.actor?.name || "System",
        lastModifiedByName: input.actor?.name || "System",
      })
      .returning();
  }

  // Reflect the CAPA state onto the NC so the queue reads true.
  const ncStatus = verifying && input.effectivenessResult === "effective"
    ? "closed"
    : completing
      ? "effectiveness_check"
      : "capa_in_progress";
  await tx
    .update(qmsNonconformances)
    .set({
      status: ncStatus,
      closedAt: ncStatus === "closed" ? now : null,
      lastModifiedByName: input.actor?.name || "System",
      updatedAt: now,
    })
    .where(eq(qmsNonconformances.id, input.nonconformanceId));

  return capa;
}

export function listCapas(tx: Tx) {
  return tx.select().from(qmsCapas).orderBy(desc(qmsCapas.createdAt));
}

// ── Audits ────────────────────────────────────────────────────────────────────
export function listAudits(tx: Tx) {
  return tx.select().from(qmsAudits).orderBy(desc(qmsAudits.plannedDate));
}

export async function createAudit(
  tx: Tx,
  input: {
    companyId: string;
    title: string;
    standard?: string | null;
    auditorUserId?: string | null;
    auditorName?: string | null;
    department?: string | null;
    plannedDate?: string | null;
    status?: string;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const auditNumber = await nextNumber(tx, input.companyId, "AUD");
  const [row] = await tx
    .insert(qmsAudits)
    .values({
      companyId: input.companyId,
      auditNumber,
      title: input.title.trim(),
      standard: input.standard?.trim() ?? "",
      auditorUserId: input.auditorUserId || null,
      auditorName: input.auditorName?.trim() ?? "",
      department: input.department?.trim() ?? "",
      plannedDate: input.plannedDate || null,
      status: input.status ?? "planned",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateAudit(tx: Tx, id: string, patch: Record<string, unknown>, actor: Actor) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of ["status", "findings", "findingsCount", "completedDate"]) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" ? null : patch[k];
  }
  if (set.findings === null) set.findings = "";
  if (set.findingsCount === null) set.findingsCount = 0;
  if (patch.status === "closed" && patch.completedDate === undefined) {
    set.completedDate = new Date().toISOString().slice(0, 10);
  }
  const [row] = await tx.update(qmsAudits).set(set).where(eq(qmsAudits.id, id)).returning();
  return row ?? null;
}

export async function deleteAudit(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(qmsAudits).where(eq(qmsAudits.id, id)).returning({ id: qmsAudits.id });
  return rows.length > 0;
}

// ── Management reviews ────────────────────────────────────────────────────────
export function listReviews(tx: Tx) {
  return tx.select().from(qmsManagementReviews).orderBy(desc(qmsManagementReviews.reviewDate));
}

export async function createReview(
  tx: Tx,
  input: {
    companyId: string;
    reviewDate?: string | null;
    chairedBy?: string | null;
    attendees?: string | null;
    status?: string;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const reviewNumber = await nextNumber(tx, input.companyId, "MR");
  const [row] = await tx
    .insert(qmsManagementReviews)
    .values({
      companyId: input.companyId,
      reviewNumber,
      reviewDate: input.reviewDate || null,
      chairedBy: input.chairedBy?.trim() ?? "",
      attendees: input.attendees?.trim() ?? "",
      status: input.status ?? "scheduled",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateReview(tx: Tx, id: string, patch: Record<string, unknown>, actor: Actor) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of ["status", "decisions", "actionsCount"]) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  const [row] = await tx.update(qmsManagementReviews).set(set).where(eq(qmsManagementReviews.id, id)).returning();
  return row ?? null;
}

export async function deleteReview(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(qmsManagementReviews).where(eq(qmsManagementReviews.id, id)).returning({ id: qmsManagementReviews.id });
  return rows.length > 0;
}

// ── Stats ────────────────────────────────────────────────────────────────────
export async function getQmsStats(tx: Tx) {
  const [nc] = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::int AS open_ncs
      FROM qms_nonconformances
  `)) as unknown as Array<{ open_ncs: number }>;
  const [capa] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (
        WHERE status IN ('open','in_progress')
          AND due_date IS NOT NULL AND due_date < CURRENT_DATE
      )::int AS overdue,
      count(*) FILTER (
        WHERE status = 'completed' AND effectiveness_result = 'pending'
      )::int AS awaiting_effectiveness
      FROM qms_capas
  `)) as unknown as Array<{ overdue: number; awaiting_effectiveness: number }>;
  const [aud] = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'planned')::int AS planned FROM qms_audits
  `)) as unknown as Array<{ planned: number }>;
  return {
    openNcs: nc?.open_ncs ?? 0,
    overdueCapa: capa?.overdue ?? 0,
    awaitingEffectiveness: capa?.awaiting_effectiveness ?? 0,
    auditsPlanned: aud?.planned ?? 0,
  };
}
