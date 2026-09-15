"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { BID_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/bids";
import * as usersRepo from "../repositories/users";

/**
 * Bids actions — 0111. Zod validates, `withAuthorizedTenant` scopes and gates,
 * the repository does the SQL. Reads open to any member; writes need
 * BID_WRITE_ROLES.
 */

const WRITE = BID_WRITE_ROLES as unknown as string[];
const STAGES = ["draft", "preparing", "submitted", "stage_2b", "evaluation", "awarded", "lost", "stopped"] as const;
const COMPLIANCE = ["pending", "compliant", "non_compliant"] as const;

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
  revalidatePath("/dashboard/bids");
}

export async function getBidsData() {
  return withAuthorizedTenant([], async (tx) => {
    const [rows, stats, users] = await Promise.all([
      repo.listBids(tx),
      repo.getBidStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      bids: rows.map(serialize),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name })),
    };
  });
}

const bidSchema = z.object({
  bidName: z.string().trim().min(1, "A bid needs a name").max(200),
  procuringEntity: z.string().trim().max(200).optional(),
  value: z.coerce.number().min(0).optional(),
  winProbability: z.coerce.number().min(0).max(100).optional(),
  stage: z.enum(STAGES).optional(),
  compliance: z.enum(COMPLIANCE).optional(),
  submissionDeadline: z.string().trim().optional(),
  ownerUserId: z.string().trim().optional(),
  ownerName: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createBid(prevState: unknown, formData: FormData) {
  const parsed = bidSchema.safeParse({
    bidName: s(formData.get("bidName")),
    procuringEntity: s(formData.get("procuringEntity")),
    value: s(formData.get("value")) || 0,
    winProbability: s(formData.get("winProbability")) || 0,
    stage: s(formData.get("stage")) || undefined,
    compliance: s(formData.get("compliance")) || undefined,
    submissionDeadline: s(formData.get("submissionDeadline")),
    ownerUserId: s(formData.get("ownerUserId")),
    ownerName: s(formData.get("ownerName")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createBid(tx, {
        companyId,
        ...d,
        ownerUserId: d.ownerUserId || null,
        submissionDeadline: d.submissionDeadline || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.bidNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateBid(id: string, patch: Record<string, unknown>) {
  const parsed = bidSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateBid(tx, id, parsed.data, actorFrom(user)),
    );
    if (!row) return { error: "Bid not found." };
    bump();
    return { success: true, message: `${row.bidNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setBidStage(id: string, stage: string) {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) return { error: "Unknown stage." };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.setBidStage(tx, id, stage, actorFrom(user)),
    );
    if (!row) return { error: "Bid not found." };
    bump();
    return { success: true, message: `${row.bidNumber} → ${stage.replace("_", " ")}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteBid(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteBid(tx, id));
    if (!ok) return { error: "Bid not found." };
    bump();
    return { success: true, message: "Bid deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
