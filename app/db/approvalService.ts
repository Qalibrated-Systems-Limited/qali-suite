import "server-only";
import type { Tx } from "./client";
import * as approvals from "./repositories/approvals";
import * as steps from "./repositories/approvalSteps";
import { APPROVER_MATRIX, STEP_ALWAYS_ALLOWED } from "@/lib/business-rules";

/**
 * Raising an approval inside a caller's own transaction — shared by the
 * approval actions and by actions (stock counts) that must raise the request
 * in the same transaction as the document it holds.
 *
 * Not a "use server" module: nothing here is callable from a browser.
 */
export interface RaiseInput {
  type: string;
  targetRef: { kind: string; id: string; label?: string };
  payload?: Record<string, unknown>;
  reason?: string;
  requesterNote?: string;
  context?: Record<string, unknown>;
}

type Who = { id?: string | null; name?: string | null; email?: string | null; role?: string | null };

export async function raiseApprovalIn(tx: Tx, user: Who, companyId: string, input: RaiseInput) {
  const matrix = (APPROVER_MATRIX as Record<string, string[]>)[input.type];
  if (!matrix?.length) throw new Error(`No approver matrix for type "${input.type}"`);

  const chain = steps.isStepType(input.type) ? await steps.stepsFor(tx, input.type) : [];
  const roles =
    chain.length > 1
      ? Array.from(new Set([...STEP_ALWAYS_ALLOWED, ...chain.flatMap((s) => s.roles)]))
      : matrix;

  return approvals.submitApproval(tx, {
    companyId,
    type: input.type,
    targetKind: input.targetRef.kind,
    targetId: String(input.targetRef.id),
    targetLabel: input.targetRef.label ?? null,
    payload: input.payload ?? {},
    context: input.context ?? {},
    reason: input.reason ?? "",
    requesterNote: input.requesterNote ?? "",
    requiredApproverRoles: roles,
    submittedById: String(user?.id ?? "system"),
    submittedByName: user?.name || user?.email || "System",
    submittedByRole: user?.role ?? null,
    steps: chain.length > 1 ? chain : undefined,
  });
}
