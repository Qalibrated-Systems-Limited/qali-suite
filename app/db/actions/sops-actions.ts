"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { SOP_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/sops";
import * as usersRepo from "../repositories/users";

/**
 * SOP Library actions — 0115. Zod validates, `withAuthorizedTenant` scopes and
 * gates, the repository does the SQL. Reads open to any member; writes need
 * SOP_WRITE_ROLES.
 */

const WRITE = SOP_WRITE_ROLES as unknown as string[];

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
  revalidatePath("/dashboard/sops");
}

export async function getSopsData() {
  return withAuthorizedTenant([], async (tx) => {
    const [rows, stats, users] = await Promise.all([
      repo.listSops(tx),
      repo.getSopStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      sops: rows.map(serialize),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name })),
    };
  });
}

const sopSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200),
  department: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  version: z.string().trim().max(20).optional(),
  status: z.enum(["draft", "in_review", "approved", "retired"]).optional(),
  ownerUserId: z.string().trim().optional(),
  ownerName: z.string().trim().max(160).optional(),
  lastReviewed: z.string().trim().optional(),
  nextReview: z.string().trim().optional(),
});

export async function createSop(prevState: unknown, formData: FormData) {
  const parsed = sopSchema.safeParse({
    title: s(formData.get("title")),
    department: s(formData.get("department")),
    category: s(formData.get("category")),
    version: s(formData.get("version")) || undefined,
    status: s(formData.get("status")) || undefined,
    ownerUserId: s(formData.get("ownerUserId")),
    ownerName: s(formData.get("ownerName")),
    lastReviewed: s(formData.get("lastReviewed")),
    nextReview: s(formData.get("nextReview")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createSop(tx, {
        companyId,
        ...parsed.data,
        ownerUserId: parsed.data.ownerUserId || null,
        lastReviewed: parsed.data.lastReviewed || null,
        nextReview: parsed.data.nextReview || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.code} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateSop(id: string, patch: Record<string, unknown>) {
  const parsed = sopSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateSop(tx, id, parsed.data, actorFrom(user)),
    );
    if (!row) return { error: "SOP not found." };
    bump();
    return { success: true, message: `${row.code} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function markReviewed(id: string, when: string, nextReview) {
  const w = when || new Date().toISOString().slice(0, 10);
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.markReviewed(tx, id, w, nextReview || null, actorFrom(user)),
    );
    if (!row) return { error: "SOP not found." };
    bump();
    return { success: true, message: `${row.code} reviewed` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteSop(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteSop(tx, id));
    if (!ok) return { error: "SOP not found." };
    bump();
    return { success: true, message: "SOP deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
