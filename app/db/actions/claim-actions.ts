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
import * as accountsRepo from "../repositories/accounts";
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
    return await withAuthorizedTenant([], (tx) =>
      claims.listClaimsForScreen(tx, opts),
    );
  } catch {
    return { claims: [], total: 0 };
  }
}

export async function getClaimDetailPg(claimId: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.getClaimForScreen(tx, claimId),
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
      claims.listClaimsForScreen(tx, { ...opts, userId: user.id }),
    );
  } catch {
    return { claims: [], total: 0 };
  }
}

/** The approvals badge and the dashboard strips. */
export async function countClaimsAwaitingApprovalPg(
  claimType?: string | string[],
) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.countClaimsAwaitingApproval(tx, claimType),
    );
  } catch {
    return 0;
  }
}

/** Any count a dashboard needs, without another round trip per tile. */
export async function countClaimsPg(
  opts: Parameters<typeof claims.countClaims>[1] = {},
) {
  try {
    return await withAuthorizedTenant([], (tx) => claims.countClaims(tx, opts));
  } catch {
    return 0;
  }
}

/** How many claims match, and what they add up to. */
export async function sumClaimsPg(
  opts: Parameters<typeof claims.sumClaims>[1] = {},
) {
  try {
    return await withAuthorizedTenant([], (tx) => claims.sumClaims(tx, opts));
  } catch {
    return { count: 0, total: 0 };
  }
}

/** What one person still has in flight — the "my alerts" strip. */
export async function countMyOpenClaimsPg(userId: string) {
  return countClaimsPg({ status: ["submitted", "approved"], userId });
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
    return { claimCount: 0, committed: 0, actual: 0 };
  }
}

/** The budget page's per-account breakdown of a project's claim spend. */
export async function getProjectClaimsByAccountPg(projectId: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      claims.getProjectClaimsByAccount(tx, projectId),
    );
  } catch {
    return { actuals: [], committed: [] };
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

// ─────────────────────────────────────────────────────────────────────────────
// The read functions the pages import
//
// Same names and same signatures as `app/mongodb/queries/claimQueries.js`, so
// a page moves to Postgres by changing one import line. Exported from here
// rather than a query module because these need a session-scoped transaction,
// and `withAuthorizedTenant` is the door for that.
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 20;

interface ClaimFilters {
  status?: string;
  claimType?: string;
  userId?: string;
  userRole?: string;
}

/**
 * Employees see their own claims; everybody else sees the company's.
 *
 * The Mongo pair got this subtly different from each other — `fetchClaimPages`
 * scopes on `userRole === "employee" || "user"`, while `searchClaims` scopes on
 * that OR a truthy `userId`, so the page COUNT and the page CONTENTS could
 * disagree about whose claims were being listed. One helper, used by both.
 */
function scopeFor(filters: ClaimFilters): claims.ListClaimsOptions {
  const role = (filters.userRole ?? "").toLowerCase();
  const ownClaimsOnly = role === "employee" || role === "user";
  return {
    status: filters.status && filters.status !== "all" ? filters.status : undefined,
    claimType:
      filters.claimType && filters.claimType !== "all"
        ? filters.claimType
        : undefined,
    userId: ownClaimsOnly || filters.userId ? filters.userId : undefined,
  };
}

export async function fetchClaimPages(searchTerm = "", filters: ClaimFilters = {}) {
  try {
    const { total } = await withAuthorizedTenant([], (tx) =>
      claims.listClaims(tx, {
        ...scopeFor(filters),
        search: searchTerm || undefined,
        limit: 1,
      }),
    );
    return Math.max(Math.ceil(total / ITEMS_PER_PAGE), 1);
  } catch {
    return 1;
  }
}

export async function searchClaims(
  searchTerm = "",
  page = 1,
  filters: ClaimFilters = {},
) {
  try {
    const { claims: rows } = await withAuthorizedTenant([], (tx) =>
      claims.listClaimsForScreen(tx, {
        ...scopeFor(filters),
        search: searchTerm || undefined,
        limit: ITEMS_PER_PAGE,
        offset: (Math.max(page, 1) - 1) * ITEMS_PER_PAGE,
      }),
    );
    return rows;
  } catch {
    return [];
  }
}

export async function getPendingApprovalClaims(searchTerm = "", page = 1) {
  return searchClaims(searchTerm, page, { status: "submitted" });
}

export async function getPendingPaymentClaims(searchTerm = "", page = 1) {
  return searchClaims(searchTerm, page, { status: "approved" });
}

export async function getUserClaims(userId: string, page = 1, filters: ClaimFilters = {}) {
  return searchClaims("", page, { ...filters, userId });
}

export async function searchUserClaims(
  userId: string,
  userRole: string,
  searchTerm = "",
  page = 1,
  filters: ClaimFilters = {},
) {
  return searchClaims(searchTerm, page, { ...filters, userId, userRole });
}

export async function fetchUserClaimPages(
  userId: string,
  userRole: string,
  searchTerm = "",
  filters: ClaimFilters = {},
) {
  return fetchClaimPages(searchTerm, { ...filters, userId, userRole });
}

/** The stats strip, in the shape ClaimStats renders. */
export async function getClaimStats(userId: string | null = null) {
  const empty = {
    total: 0,
    pending: 0,
    approved: 0,
    paid: 0,
    rejected: 0,
    totalPendingAmount: 0,
    totalApprovedAmount: 0,
    totalPaidAmount: 0,
  };

  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT c.status::text AS status,
               COUNT(*)::int AS n,
               COALESCE(SUM(s.total_amount), 0)::float8 AS amount
          FROM employee_claims c
          JOIN employee_claim_state s ON s.claim_id = c.id
         ${userId ? sql`WHERE c.employee_user_id = ${String(userId)}` : sql``}
         GROUP BY c.status
      `)) as unknown as Array<{ status: string; n: number; amount: number }>;

      const by = Object.fromEntries(rows.map((r) => [r.status, r]));
      const count = (s: string) => by[s]?.n ?? 0;
      const amount = (s: string) => by[s]?.amount ?? 0;

      return {
        total: rows.reduce((sum, r) => sum + r.n, 0),
        pending: count("submitted"),
        approved: count("approved"),
        paid: count("paid"),
        rejected: count("rejected"),
        totalPendingAmount: amount("submitted"),
        totalApprovedAmount: amount("approved"),
        totalPaidAmount: amount("paid"),
      };
    });
  } catch {
    return empty;
  }
}

export async function getClaimById(claimId: string) {
  if (!claimId || !/^[0-9a-f-]{36}$/i.test(claimId)) return null;
  return getClaimDetailPg(claimId);
}

export async function getClaimsByType(claimType: string, page = 1) {
  return searchClaims("", page, { claimType });
}

/**
 * Advances this person has drawn and not yet settled.
 *
 * One query. Mongo runs the list and then a `findOne` PER ROW, matching on
 * `returnDetails.advancePaymentId` — a field that holds a journal entry id
 * copied from another field that also holds a journal entry id, in a pair of
 * columns both declared `ref: "Payment"`. Here the settlement points at its
 * advance and the absence of one is a LEFT JOIN.
 */
export async function getAdvancesNeedingSettlement(userId: string) {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT a.id
          FROM employee_claims a
          LEFT JOIN employee_claims s
                 ON s.advance_claim_id = a.id AND s.status <> 'rejected'
         WHERE a.claim_type = 'advance_request'
           AND a.status = 'paid'
           AND a.employee_user_id = ${String(userId)}
           AND s.id IS NULL
         ORDER BY a.claim_date DESC
      `)) as unknown as Array<{ id: string }>;

      const found = await Promise.all(
        rows.map((r) => claims.getClaim(tx, r.id)),
      );
      return found
        .filter((c): c is NonNullable<typeof c> => c != null)
        .map((c) => claims.toClaimViewModel(c));
    });
  } catch {
    return [];
  }
}

/** The expense accounts a claim line may be charged to. */
export async function getExpenseAccountsForCategories() {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id, account_code, account_name, sub_type
          FROM accounts
         WHERE account_type = 'expense' AND can_post = true AND is_active = true
         ORDER BY account_code
      `)) as unknown as Array<Record<string, string>>;

      return rows.map((r) => ({
        _id: r.id,
        id: r.id,
        accountCode: r.account_code,
        accountName: r.account_name,
        subType: r.sub_type,
      }));
    });
  } catch {
    return [];
  }
}

/**
 * Cash, bank and M-Pesa accounts the claim payment dialogs offer.
 *
 * The claim detail page read these from the MONGO Account collection, which
 * nothing has written since 0035 — so all three dialogs on that page offered
 * an empty account list and no claim could be paid from it.
 *
 * Gated on CLAIM_PAY_ROLES: this list exists to be spent from, and the page
 * hands it to the settle, reimburse and pay dialogs.
 *
 * The shape is the page's, not the repository's — it renders `accountCode` and
 * `accountName`, where `listPaymentAccounts` says `code` and `name`.
 */
export async function getClaimPaymentAccountsPg() {
  return withAuthorizedTenant([...CLAIM_PAY_ROLES], async (tx) => {
    const rows = await accountsRepo.listPaymentAccounts(tx);
    return rows.map((a) => ({
      _id: a._id,
      accountCode: a.code,
      accountName: a.name,
      subType: a.subType,
    }));
  });
}
