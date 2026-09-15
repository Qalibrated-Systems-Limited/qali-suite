"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { QMS_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/qms";
import * as usersRepo from "../repositories/users";

/**
 * QMS actions — 0114. Zod validates, `withAuthorizedTenant` scopes and gates,
 * the repository does the SQL. Reads open to any member; writes need
 * QMS_WRITE_ROLES.
 */

const WRITE = QMS_WRITE_ROLES as unknown as string[];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row, _id: String(row.id) };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
  }
  return out;
}
function bump() {
  revalidatePath("/dashboard/qms");
}

export async function getQmsData() {
  return withAuthorizedTenant([], async (tx) => {
    const [ncs, audits, reviews, capas, stats, users] = await Promise.all([
      repo.listNonconformances(tx),
      repo.listAudits(tx),
      repo.listReviews(tx),
      repo.listCapas(tx),
      repo.getQmsStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      ncs,
      audits: audits.map(serialize),
      reviews: reviews.map(serialize),
      capas: capas.map(serialize),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name })),
    };
  });
}

// ── Non-conformances ────────────────────────────────────────────────────────────
const ncSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200),
  source: z.enum(["internal_audit", "external_audit", "customer_complaint", "supplier", "process", "product", "other"]).optional(),
  category: z.enum(["process", "product", "system", "external", "other"]).optional(),
  description: z.string().trim().max(4000).optional(),
  isoClause: z.string().trim().max(40).optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
  ownerUserId: z.string().trim().optional(),
  ownerName: z.string().trim().max(160).optional(),
  dueDate: z.string().trim().optional(),
});

export async function raiseNc(prevState: unknown, formData: FormData) {
  const parsed = ncSchema.safeParse({
    title: s(formData.get("title")),
    source: s(formData.get("source")) || undefined,
    category: s(formData.get("category")) || undefined,
    description: s(formData.get("description")),
    isoClause: s(formData.get("isoClause")),
    severity: s(formData.get("severity")) || undefined,
    ownerUserId: s(formData.get("ownerUserId")),
    ownerName: s(formData.get("ownerName")),
    dueDate: s(formData.get("dueDate")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createNonconformance(tx, {
        companyId,
        ...parsed.data,
        ownerUserId: parsed.data.ownerUserId || null,
        dueDate: parsed.data.dueDate || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.ncNumber} raised` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setNcStatus(id: string, status: string) {
  if (!["open", "capa_in_progress", "effectiveness_check", "closed", "cancelled"].includes(status)) {
    return { error: "Unknown status." };
  }
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.setNcStatus(tx, id, status, actorFrom(user)),
    );
    if (!row) return { error: "NC not found." };
    bump();
    return { success: true, message: `${row.ncNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteNc(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteNc(tx, id));
    if (!ok) return { error: "NC not found." };
    bump();
    return { success: true, message: "NC deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── CAPA ────────────────────────────────────────────────────────────────────────
const capaSchema = z.object({
  nonconformanceId: z.string().trim().min(1),
  capaId: z.string().trim().optional().nullable(),
  type: z.enum(["corrective", "preventive"]).optional(),
  action: z.string().trim().max(4000).optional(),
  ownerUserId: z.string().trim().optional(),
  ownerName: z.string().trim().max(160).optional(),
  dueDate: z.string().trim().optional(),
  status: z.enum(["open", "in_progress", "completed", "verified", "cancelled"]).optional(),
  effectivenessDue: z.string().trim().optional(),
  effectivenessResult: z.enum(["pending", "effective", "not_effective"]).optional(),
});

export async function saveCapa(input: unknown) {
  const parsed = capaSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the CAPA" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.upsertCapa(tx, {
        companyId,
        nonconformanceId: d.nonconformanceId,
        capaId: d.capaId || null,
        type: d.type,
        action: d.action,
        ownerUserId: d.ownerUserId || null,
        ownerName: d.ownerName,
        dueDate: d.dueDate || null,
        status: d.status,
        effectivenessDue: d.effectivenessDue || null,
        effectivenessResult: d.effectivenessResult,
        actor: actorFrom(user),
      }),
    );
    bump();
    return { success: true, message: `${row?.capaNumber ?? "CAPA"} saved` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Audits ────────────────────────────────────────────────────────────────────
const auditSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200),
  standard: z.string().trim().max(60).optional(),
  auditorUserId: z.string().trim().optional(),
  auditorName: z.string().trim().max(160).optional(),
  department: z.string().trim().max(120).optional(),
  plannedDate: z.string().trim().optional(),
});

export async function createAudit(prevState: unknown, formData: FormData) {
  const parsed = auditSchema.safeParse({
    title: s(formData.get("title")),
    standard: s(formData.get("standard")),
    auditorUserId: s(formData.get("auditorUserId")),
    auditorName: s(formData.get("auditorName")),
    department: s(formData.get("department")),
    plannedDate: s(formData.get("plannedDate")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createAudit(tx, {
        companyId,
        ...parsed.data,
        auditorUserId: parsed.data.auditorUserId || null,
        plannedDate: parsed.data.plannedDate || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.auditNumber} planned` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateAudit(id: string, patch: Record<string, unknown>) {
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateAudit(tx, id, patch, actorFrom(user)),
    );
    if (!row) return { error: "Audit not found." };
    bump();
    return { success: true, message: `${row.auditNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteAudit(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteAudit(tx, id));
    if (!ok) return { error: "Audit not found." };
    bump();
    return { success: true, message: "Audit deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Management reviews ────────────────────────────────────────────────────────
const reviewSchema = z.object({
  reviewDate: z.string().trim().optional(),
  chairedBy: z.string().trim().max(160).optional(),
  attendees: z.string().trim().max(400).optional(),
});

export async function scheduleReview(prevState: unknown, formData: FormData) {
  const parsed = reviewSchema.safeParse({
    reviewDate: s(formData.get("reviewDate")),
    chairedBy: s(formData.get("chairedBy")),
    attendees: s(formData.get("attendees")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createReview(tx, {
        companyId,
        ...parsed.data,
        reviewDate: parsed.data.reviewDate || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.reviewNumber} scheduled` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateReview(id: string, patch: Record<string, unknown>) {
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateReview(tx, id, patch, actorFrom(user)),
    );
    if (!row) return { error: "Review not found." };
    bump();
    return { success: true, message: `${row.reviewNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteReview(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteReview(tx, id));
    if (!ok) return { error: "Review not found." };
    bump();
    return { success: true, message: "Review deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
