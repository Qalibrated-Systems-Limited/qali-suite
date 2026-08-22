"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import type { Tx } from "../client";
import {
  CLAIM_APPROVE_ROLES,
  CLAIM_PAY_ROLES,
  FINANCE_WRITE_ROLES,
} from "@/lib/utils/role-gates";
import * as claims from "../repositories/claims";
import {
  advanceRequestSchema,
  reimbursementSchema,
  settleAdvanceSchema,
  claimPaymentSchema,
  settlementCashSchema,
  rejectClaimSchema,
  toClaimItems,
  toClaimAttachments,
  toMoney,
} from "../validation/claims";

/**
 * Claim actions on Postgres (§9G).
 *
 * The five money-moving ones are why this module exists: in Mongo each posts a
 * journal entry through the Mongoose model, into a ledger no screen reads.
 * Here they call the repository, which posts into the ledger the trial balance
 * opens.
 *
 * RESULT SHAPES ARE THE COMPONENTS'. `ApproveClaimDialog` tests
 * `state?.message === "success"`, `PayClaimDialog` tests `state?.success` and
 * renders `state.errors.paymentAccountId[0]`, `RecallClaimButton` reads
 * `result.success` and `result.message`. Each function below returns exactly
 * what its caller already expects, so the screens move over by changing an
 * import — which is the step the quotes port forgot, and the reason every
 * quote raised through the UI went into a store the list page did not read.
 */

type FieldErrors = Record<string, string[]>;

/** `{ errors: { field: [...] } }`, the shape every claim form renders. */
function fieldErrorsFrom(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

function formError(message: string) {
  return { errors: { _form: [message] } as FieldErrors };
}

function revalidateClaim(claimId?: string | null, projectId?: string | null) {
  revalidatePath("/dashboard/claims");
  revalidatePath("/dashboard/my-claims");
  if (claimId) revalidatePath(`/dashboard/claims/${claimId}`);
  if (projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

/** Keeps the user's typing on the form when validation sends them back. */
function valuesOf(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/**
 * Who this claim is FOR, which is not always who is filing it.
 *
 * Finance roles may record an advance on behalf of an employee — the Mongo
 * action's own words: it "captures manual advances at the source instead of
 * off the books". The claim belongs to the employee; `createdBy` stays the
 * recorder.
 */
async function resolveSubject(
  tx: Tx,
  user: { id: string; name?: string | null; email?: string | null; role?: string },
  companyId: string,
  onBehalfUserId?: string | null,
) {
  if (!onBehalfUserId || onBehalfUserId === user.id) {
    const { partyId, employeeId } = await claims.ensureEmployeeParty(tx, {
      companyId,
      userId: user.id,
      name: user.name,
      email: user.email,
    });
    return { partyId, employeeId, userId: user.id };
  }

  if (!FINANCE_WRITE_ROLES.includes(user.role ?? "")) {
    throw new Error(
      "Only finance roles can record an advance on behalf of an employee.",
    );
  }

  // No company filter, and none is needed: 0036's `visible_within_company`
  // policy already restricts users to people holding an active grant in the
  // company this request is scoped to.
  const rows = (await tx.execute(sql`
    SELECT id, name, email FROM users WHERE id = ${String(onBehalfUserId)}
  `)) as unknown as Array<{ id: string; name: string; email: string }>;

  if (!rows.length) throw new Error("Selected employee not found.");

  const target = rows[0];
  const { partyId, employeeId } = await claims.ensureEmployeeParty(tx, {
    companyId,
    userId: target.id,
    name: target.name,
    email: target.email,
  });
  return { partyId, employeeId, userId: target.id };
}

const today = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Creating
// ─────────────────────────────────────────────────────────────────────────────

export async function createAdvanceRequestPg(
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = advanceRequestSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values: valuesOf(formData) };
  }
  const data = parsed.data;

  try {
    const claim = await withAuthorizedTenant(
      [],
      async (tx, { user, companyId }) => {
        const subject = await resolveSubject(
          tx,
          user,
          companyId,
          data.onBehalfUserId,
        );

        return claims.createAdvanceRequest(tx, {
          companyId,
          partyId: subject.partyId,
          employeeId: subject.employeeId,
          employeeUserId: subject.userId,
          claimDate: today(),
          advanceType: data.advanceType,
          requestedAmount: toMoney(data.requestedAmount),
          purpose: data.purpose,
          description: data.purpose,
          travelFrom: data.travelFromDate ?? null,
          travelTo: data.travelToDate ?? null,
          destination: data.destination ?? null,
          estimatedExpenses: data.estimatedExpenses ?? null,
          projectId: data.projectId,
          notes: data.notes ?? null,
          attachments: toClaimAttachments(data.receipts, {
            id: user.id,
            name: user.name,
          }),
          // Mongo submits on create — there is no draft step on this form.
          submit: true,
          createdById: user.id,
          createdByName: user.name ?? null,
        });
      },
    );

    revalidateClaim(claim.id, data.projectId);
    return {
      success: true,
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      message: "Advance request submitted successfully",
    };
  } catch (error) {
    return { ...formError(userMessage(error)), values: valuesOf(formData) };
  }
}

export async function createReimbursementPg(
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = reimbursementSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values: valuesOf(formData) };
  }
  const data = parsed.data;

  try {
    const claim = await withAuthorizedTenant(
      [],
      async (tx, { user, companyId }) => {
        const { partyId, employeeId } = await claims.ensureEmployeeParty(tx, {
          companyId,
          userId: user.id,
          name: user.name,
          email: user.email,
        });

        return claims.createReimbursement(tx, {
          companyId,
          partyId,
          employeeId,
          employeeUserId: user.id,
          claimDate: today(),
          description: data.description,
          items: toClaimItems(data.items),
          projectId: data.projectId,
          notes: data.notes ?? null,
          attachments: toClaimAttachments(data.receipts, {
            id: user.id,
            name: user.name,
          }),
          submit: true,
          createdById: user.id,
          createdByName: user.name ?? null,
        });
      },
    );

    revalidateClaim(claim.id, data.projectId);
    return {
      success: true,
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      message: "Reimbursement claim submitted successfully",
    };
  } catch (error) {
    return { ...formError(userMessage(error)), values: valuesOf(formData) };
  }
}

export async function updateClaimPg(
  claimId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const raw = Object.fromEntries(formData.entries());
  const isAdvance = Boolean(raw.advanceType);
  const parsed = isAdvance
    ? advanceRequestSchema.safeParse(raw)
    : reimbursementSchema.safeParse(raw);

  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values: valuesOf(formData) };
  }

  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      const data = parsed.data as Record<string, unknown>;
      return claims.updateClaim(tx, claimId, {
        ...(isAdvance
          ? {
              advanceType: data.advanceType as string,
              requestedAmount: toMoney(data.requestedAmount as number),
              purpose: data.purpose as string,
              description: data.purpose as string,
              travelFrom: (data.travelFromDate as string) ?? null,
              travelTo: (data.travelToDate as string) ?? null,
              destination: (data.destination as string) ?? null,
              estimatedExpenses: (data.estimatedExpenses as string) ?? null,
            }
          : {
              description: data.description as string,
              items: toClaimItems(
                data.items as Parameters<typeof toClaimItems>[0],
              ),
            }),
        projectId: (data.projectId as string) ?? null,
        notes: (data.notes as string) ?? null,
        lastModifiedById: user.id,
        lastModifiedByName: user.name ?? null,
      });
    });

    revalidateClaim(claimId);
    return { success: true, claimId, message: "Claim updated" };
  } catch (error) {
    return { ...formError(userMessage(error)), values: valuesOf(formData) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval
// ─────────────────────────────────────────────────────────────────────────────

export async function approveEmployeeClaimPg(claimId: string) {
  try {
    const claim = await withAuthorizedTenant(
      [...CLAIM_APPROVE_ROLES],
      (tx, { user }) =>
        claims.approveClaim(tx, claimId, { id: user.id, name: user.name }),
    );
    revalidateClaim(claimId, claim?.projectId);
    return { message: "success" };
  } catch (error) {
    return { message: userMessage(error, "Failed to approve claim") };
  }
}

export async function rejectEmployeeClaimPg(
  claimId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = rejectClaimSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "A reason is required" };
  }

  try {
    const claim = await withAuthorizedTenant(
      [...CLAIM_APPROVE_ROLES],
      (tx, { user }) =>
        claims.rejectClaim(tx, claimId, {
          id: user.id,
          name: user.name,
          reason: parsed.data.reason,
        }),
    );
    revalidateClaim(claimId, claim?.projectId);
    return { message: "success" };
  } catch (error) {
    return { message: userMessage(error, "Failed to reject claim") };
  }
}

/** submitted → draft, and only by the person whose claim it is. */
export async function recallEmployeeClaimPg(claimId: string) {
  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      const claim = await claims.getClaim(tx, claimId);
      if (!claim) throw new Error("Claim not found");
      if (claim.employeeUserId !== user.id) {
        throw new Error("You can only recall your own claims");
      }
      return claims.recallClaim(tx, claimId);
    });
    revalidateClaim(claimId);
    return { success: true, message: "Claim recalled to draft" };
  } catch (error) {
    return {
      success: false,
      message: userMessage(error, "Failed to recall claim"),
    };
  }
}

/** rejected → submitted, and only by the person whose claim it is. */
export async function resubmitEmployeeClaimPg(claimId: string) {
  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      const claim = await claims.getClaim(tx, claimId);
      if (!claim) throw new Error("Claim not found");
      if (claim.employeeUserId !== user.id) {
        throw new Error("You can only resubmit your own claims");
      }
      return claims.resubmitClaim(tx, claimId, { id: user.id, name: user.name });
    });
    revalidateClaim(claimId);
    return { success: true, message: "Claim resubmitted for approval" };
  } catch (error) {
    return {
      success: false,
      message: userMessage(error, "Failed to resubmit claim"),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The money
// ─────────────────────────────────────────────────────────────────────────────

export async function payAdvancePg(
  claimId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = claimPaymentSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error) };
  const data = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...CLAIM_PAY_ROLES],
      (tx, { user }) =>
        claims.payAdvance(tx, claimId, {
          paymentAccountId: data.paymentAccountId,
          paymentMethod: data.paymentMethod ?? null,
          paymentReference: data.paymentReference ?? null,
          paymentNotes: data.paymentNotes ?? null,
          paidById: user.id,
          paidByName: user.name ?? null,
        }),
    );

    revalidateClaim(claimId, result.claim.projectId);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      message: "Advance disbursed and posted to the ledger",
      journalEntryId: result.entry.id,
    };
  } catch (error) {
    return formError(userMessage(error, "Failed to pay advance"));
  }
}

export async function payReimbursementPg(
  claimId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = claimPaymentSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error) };
  const data = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...CLAIM_PAY_ROLES],
      (tx, { user }) =>
        claims.payReimbursement(tx, claimId, {
          paymentAccountId: data.paymentAccountId,
          paymentMethod: data.paymentMethod ?? null,
          paymentReference: data.paymentReference ?? null,
          paymentNotes: data.paymentNotes ?? null,
          paidById: user.id,
          paidByName: user.name ?? null,
        }),
    );

    revalidateClaim(claimId, result.claim.projectId);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      message: "Reimbursement paid, expense and payment both posted",
      journalEntryId: result.paymentEntry.id,
    };
  } catch (error) {
    return formError(userMessage(error, "Failed to pay reimbursement"));
  }
}

export async function settleAdvancePg(
  advanceClaimId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = settleAdvanceSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values: valuesOf(formData) };
  }
  const data = parsed.data;

  try {
    const settlement = await withAuthorizedTenant(
      [],
      async (tx, { user }) => {
        const advance = await claims.getClaim(tx, advanceClaimId);
        if (!advance) throw new Error("Advance not found");
        // The claimant settles their own advance; finance may do it for them.
        if (
          advance.employeeUserId !== user.id &&
          !FINANCE_WRITE_ROLES.includes(user.role ?? "")
        ) {
          throw new Error("You can only settle your own advance");
        }

        return claims.openSettlement(tx, advanceClaimId, {
          items: toClaimItems(data.items),
          notes: data.notes ?? null,
          attachments: toClaimAttachments(data.receipts, {
            id: user.id,
            name: user.name,
          }),
          createdById: user.id,
          createdByName: user.name ?? null,
        });
      },
    );

    const detail = await withAuthorizedTenant([], (tx) =>
      claims.getClaim(tx, settlement.id),
    );
    const balance = Number(detail?.balance ?? 0);

    revalidateClaim(advanceClaimId, detail?.projectId);
    revalidateClaim(settlement.id);

    return {
      success: true,
      settlementId: settlement.id,
      message: "Settlement submitted successfully",
      balanceMessage:
        balance > 0
          ? `You are holding ${balance.toFixed(2)} that still needs to be returned.`
          : balance < 0
            ? `You are owed ${Math.abs(balance).toFixed(2)}.`
            : null,
    };
  } catch (error) {
    return { ...formError(userMessage(error)), values: valuesOf(formData) };
  }
}

export async function closeSettlementPg(
  settlementId: string,
  _prevState: unknown,
  _formData: FormData,
) {
  try {
    const result = await withAuthorizedTenant(
      [...CLAIM_PAY_ROLES],
      (tx, { user }) =>
        claims.closeSettlement(tx, settlementId, {
          id: user.id,
          name: user.name,
        }),
    );

    revalidateClaim(settlementId, result.claim.projectId);
    revalidatePath("/dashboard/journal");

    return {
      success: true,
      status: result.status,
      balance: result.balance,
      journalEntryId: result.entry.id,
      message:
        result.status === "pending_return"
          ? `Settled. ${result.balance.toFixed(2)} is still to be returned.`
          : result.status === "pending_payment"
            ? `Settled. ${Math.abs(result.balance).toFixed(2)} is owed to the employee.`
            : "Settled and closed — the advance matched exactly.",
    };
  } catch (error) {
    return formError(userMessage(error, "Failed to close settlement"));
  }
}

export async function recordAdvanceReturnPg(
  settlementId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = settlementCashSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error) };
  const data = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...CLAIM_PAY_ROLES],
      (tx, { user }) =>
        claims.recordAdvanceReturn(tx, settlementId, {
          paymentAccountId: data.paymentAccountId,
          amount: toMoney(data.amount),
          paymentMethod: data.paymentMethod ?? null,
          reference: data.reference ?? data.paymentReference ?? null,
          recordedById: user.id,
          recordedByName: user.name ?? null,
        }),
    );

    revalidateClaim(settlementId, result.claim.projectId);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      message: "Return recorded and posted to the ledger",
      journalEntryId: result.entry.id,
    };
  } catch (error) {
    return formError(userMessage(error, "Failed to record the return"));
  }
}

export async function paySettlementBalancePg(
  settlementId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const parsed = settlementCashSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error) };
  const data = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...CLAIM_PAY_ROLES],
      (tx, { user }) =>
        claims.paySettlementBalance(tx, settlementId, {
          paymentAccountId: data.paymentAccountId,
          amount: toMoney(data.amount),
          paymentMethod: data.paymentMethod ?? null,
          reference: data.reference ?? data.paymentReference ?? null,
          recordedById: user.id,
          recordedByName: user.name ?? null,
        }),
    );

    revalidateClaim(settlementId, result.claim.projectId);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      message: "Balance paid and posted to the ledger",
      journalEntryId: result.entry.id,
    };
  } catch (error) {
    return formError(userMessage(error, "Failed to pay the balance"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads the screens call directly
// ─────────────────────────────────────────────────────────────────────────────

export async function listClaimsPg(opts: claims.ListClaimsOptions = {}) {
  try {
    return await withAuthorizedTenant([], (tx) => claims.listClaims(tx, opts));
  } catch {
    return { claims: [], total: 0 };
  }
}

export async function getClaimDetailPg(claimId: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.getClaimDetail(tx, claimId),
    );
  } catch {
    return null;
  }
}

export async function getClaimStatsPg() {
  try {
    return await withAuthorizedTenant([], (tx) => claims.getClaimStats(tx));
  } catch {
    return null;
  }
}

/** My claims — the employee's own, whoever they are. */
export async function listMyClaimsPg(opts: claims.ListClaimsOptions = {}) {
  try {
    return await withAuthorizedTenant([], (tx, { user }) =>
      claims.listClaims(tx, { ...opts, userId: user.id }),
    );
  } catch {
    return { claims: [], total: 0 };
  }
}

/** The approvals badge and the dashboard strips. */
export async function countClaimsAwaitingApprovalPg() {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.countClaimsAwaitingApproval(tx),
    );
  } catch {
    return 0;
  }
}

/**
 * What a project has spent through claims.
 *
 * Projects are still on Mongo. Without this its rollup would read a collection
 * claims no longer write to and report zero — the §9E seam, which is the bug
 * this port keeps finding.
 */
export async function getProjectClaimTotalsPg(projectId: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.getProjectClaimTotals(tx, projectId),
    );
  } catch {
    return { claimCount: 0, committed: "0", actual: "0" };
  }
}

export async function searchClaimsPg(query: string, limit = 5) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.searchClaims(tx, query, limit),
    );
  } catch {
    return [];
  }
}
