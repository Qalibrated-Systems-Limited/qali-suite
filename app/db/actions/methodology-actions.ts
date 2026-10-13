"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/projectMethodology";

/**
 * Project methodology actions — 0117. The method statement can only be started
 * once the project's budget is APPROVED (repo.hasApprovedBudget); reads are open
 * to any member, writes need PROJECT_MANAGE_ROLES.
 */

const WRITE = PROJECT_MANAGE_ROLES as unknown as string[];

const SECTION_KEYS = [
  "scope",
  "approach",
  "sequenceOfWorks",
  "resources",
  "healthSafety",
  "qualityControl",
  "programmeSummary",
  "risks",
];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function serialize(row: Record<string, unknown> | null) {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row, _id: String(row.id) };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
  }
  return out;
}

export async function getMethodologyData(projectId: string) {
  if (!projectId) return { budgetApproved: false, methodology: null };
  return withAuthorizedTenant([], async (tx) => {
    const [budgetApproved, methodology] = await Promise.all([
      repo.hasApprovedBudget(tx, projectId),
      repo.getMethodology(tx, projectId),
    ]);
    return { budgetApproved, methodology: serialize(methodology as Record<string, unknown> | null) };
  });
}

export async function saveMethodology(projectId: string, patch: Record<string, unknown>) {
  if (!projectId) return { error: "No project." };
  const clean: Record<string, unknown> = {};
  for (const k of SECTION_KEYS) {
    if (patch[k] !== undefined) clean[k] = String(patch[k] ?? "").slice(0, 20000);
  }
  try {
    const row = await withAuthorizedTenant(WRITE, async (tx, { user, companyId }) => {
      const approved = await repo.hasApprovedBudget(tx, projectId);
      if (!approved) {
        throw new Error("The project's budget must be approved before a methodology can be saved.");
      }
      return repo.upsertMethodology(tx, {
        companyId,
        projectId,
        patch: clean,
        actor: actorFrom(user),
      });
    });
    revalidatePath("/dashboard/projects/methodology");
    revalidatePath(`/dashboard/projects/${projectId}`);
    return { success: true, message: "Methodology saved", id: row?.id };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
