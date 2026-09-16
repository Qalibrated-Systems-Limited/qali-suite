"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { COMPLIANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/compliance";
import * as usersRepo from "../repositories/users";

/**
 * Compliance actions — 0116. Zod validates, `withAuthorizedTenant` scopes and
 * gates, the repository does the SQL. Reads open to any member; writes need
 * COMPLIANCE_WRITE_ROLES.
 */

const WRITE = COMPLIANCE_WRITE_ROLES as unknown as string[];

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
  revalidatePath("/dashboard/compliance");
}

export async function getComplianceData() {
  return withAuthorizedTenant([], async (tx) => {
    const [certificates, obligations, tasks, stats, users] = await Promise.all([
      repo.listCertificates(tx),
      repo.listObligations(tx),
      repo.listTasks(tx),
      repo.getComplianceStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      certificates: certificates.map(serialize),
      obligations: obligations.map(serialize),
      tasks: tasks.map(serialize),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name })),
    };
  });
}

// ── Certificates ────────────────────────────────────────────────────────────
const certSchema = z.object({
  name: z.string().trim().min(1, "A certificate name is required").max(200),
  responsibleUserId: z.string().trim().optional(),
  responsibleName: z.string().trim().max(160).optional(),
  reference: z.string().trim().max(160).optional(),
  issueDate: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCertificate(prevState: unknown, formData: FormData) {
  const parsed = certSchema.safeParse({
    name: s(formData.get("name")),
    responsibleUserId: s(formData.get("responsibleUserId")),
    responsibleName: s(formData.get("responsibleName")),
    reference: s(formData.get("reference")),
    issueDate: s(formData.get("issueDate")),
    expiryDate: s(formData.get("expiryDate")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createCertificate(tx, {
        companyId,
        ...parsed.data,
        responsibleUserId: parsed.data.responsibleUserId || null,
        issueDate: parsed.data.issueDate || null,
        expiryDate: parsed.data.expiryDate || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.name} added` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateCertificate(id: string, patch: Record<string, unknown>) {
  const parsed = certSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateCertificate(tx, id, parsed.data, actorFrom(user)),
    );
    if (!row) return { error: "Certificate not found." };
    bump();
    return { success: true, message: `${row.name} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCertificate(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteCertificate(tx, id));
    if (!ok) return { error: "Certificate not found." };
    bump();
    return { success: true, message: "Certificate deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Obligations ─────────────────────────────────────────────────────────────
const obligSchema = z.object({
  name: z.string().trim().min(1, "An obligation name is required").max(200),
  agency: z.string().trim().max(160).optional(),
  nextDue: z.string().trim().optional(),
  frequency: z.enum(["monthly", "quarterly", "annual", "one_off"]).optional(),
  penalty: z.string().trim().max(160).optional(),
});

export async function createObligation(prevState: unknown, formData: FormData) {
  const parsed = obligSchema.safeParse({
    name: s(formData.get("name")),
    agency: s(formData.get("agency")),
    nextDue: s(formData.get("nextDue")),
    frequency: s(formData.get("frequency")) || undefined,
    penalty: s(formData.get("penalty")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createObligation(tx, {
        companyId,
        ...parsed.data,
        nextDue: parsed.data.nextDue || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.name} added` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateObligation(id: string, patch: Record<string, unknown>) {
  const parsed = obligSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateObligation(tx, id, parsed.data, actorFrom(user)),
    );
    if (!row) return { error: "Obligation not found." };
    bump();
    return { success: true, message: `${row.name} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteObligation(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteObligation(tx, id));
    if (!ok) return { error: "Obligation not found." };
    bump();
    return { success: true, message: "Obligation deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Tasks ───────────────────────────────────────────────────────────────────
const taskSchema = z.object({
  title: z.string().trim().min(1, "A task title is required").max(200),
  assignedUserId: z.string().trim().optional(),
  assignedName: z.string().trim().max(160).optional(),
  dueDate: z.string().trim().optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  certificateId: z.string().trim().optional(),
});

export async function createTask(prevState: unknown, formData: FormData) {
  const parsed = taskSchema.safeParse({
    title: s(formData.get("title")),
    assignedUserId: s(formData.get("assignedUserId")),
    assignedName: s(formData.get("assignedName")),
    dueDate: s(formData.get("dueDate")),
    status: s(formData.get("status")) || undefined,
    certificateId: s(formData.get("certificateId")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createTask(tx, {
        companyId,
        ...parsed.data,
        assignedUserId: parsed.data.assignedUserId || null,
        dueDate: parsed.data.dueDate || null,
        certificateId: parsed.data.certificateId || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.title} added` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setTaskStatus(id: string, status: string) {
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.setTaskStatus(tx, id, status, actorFrom(user)),
    );
    if (!row) return { error: "Task not found." };
    bump();
    return { success: true, message: `Task marked ${status.replace("_", " ")}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteTask(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteTask(tx, id));
    if (!ok) return { error: "Task not found." };
    bump();
    return { success: true, message: "Task deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
