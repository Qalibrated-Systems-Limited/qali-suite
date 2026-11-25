"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import { ROLES } from "@/lib/capabilities";
import * as steps from "../repositories/approvalSteps";

/**
 * Settings → Approval steps. The system administrator decides, per type of
 * stock change, the steps it passes and which roles sign each. Requests
 * already open keep the chain they were raised with.
 */

const ADMIN = ADMIN_ROLES as unknown as string[];

export async function getApprovalStepPolicies() {
  return withAuthorizedTenant(ADMIN, async (tx) => ({
    policies: await steps.allPolicies(tx),
    roles: ROLES.filter((r) => r !== "SuperAdmin" && r !== "Admin"),
  }));
}

export async function saveApprovalStepPolicy(type: string, input: Array<{ label: string; roles: string[] }>) {
  try {
    if (!steps.isStepType(type)) return { error: "That type has no approval chain." };
    const clean = (Array.isArray(input) ? input : [])
      .map((s) => ({
        label: String(s?.label ?? "").trim().slice(0, 60),
        roles: Array.from(new Set((s?.roles ?? []).map(String).filter((r) => (ROLES as readonly string[]).includes(r)))),
      }));
    if (clean.length < 1 || clean.length > 5) return { error: "A chain has one to five steps." };
    const bad = clean.findIndex((s) => !s.label || s.roles.length === 0);
    if (bad >= 0) return { error: `Step ${bad + 1} needs a name and at least one role.` };
    await withAuthorizedTenant(ADMIN, (tx, { user, companyId }) =>
      steps.savePolicy(tx, companyId, type, clean, user.name || "Administrator"),
    );
    revalidatePath("/dashboard/settings/approval-steps");
    return { success: true, message: "Saved. New requests follow these steps; open ones keep theirs." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function resetApprovalStepPolicy(type: string) {
  try {
    await withAuthorizedTenant(ADMIN, (tx) => steps.resetPolicy(tx, type));
    revalidatePath("/dashboard/settings/approval-steps");
    return { success: true, message: "Back to the default steps." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
