"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { BILL_WRITE_ROLES, BILL_APPROVE_ROLES, ADMIN_ROLES } from "@/lib/utils/role-gates";
import * as billsRepo from "../repositories/bills";
import * as accountsRepo from "../repositories/accounts";

/**
 * Postgres-backed bill actions.
 *
 * Thin by design (§4.1): tenant + role gating, then a call into the
 * repository. Every accounting rule is below this — balanced postings (0001),
 * exact overpayment refusal via CHECK (balance >= 0) (0016), trigger-maintained
 * header totals, and the stock movements inside the approval's transaction.
 *
 * Money is strings end to end. Never Number() these values.
 *
 * app/mongodb/actions/bill-actions.js is the reference for BEHAVIOUR, not for
 * implementation. Where it is wrong, this does not follow it; each such point
 * is called out at the site.
 */

/**
 * The shape the existing client components already handle, so a component can
 * change data source without changing.
 */
export type ActionResult =
  | { success: true; billId?: string; billNumber?: string; message?: string }
  | { success: false; error: string };

/**
 * Postgres phrases these violations for a user already — an unbalanced entry,
 * a closed period, a missing system account, stock that would go negative.
 * Surface those; hide anything else behind a generic message and a log line,
 * so an internal error never leaks a query or a column name to the UI.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not balanced") ||
    message.includes("fiscal period") ||
    message.includes("system account") ||
    message.includes("not configured") ||
    message.includes("GR/IR") ||
    message.includes("Bill not found") ||
    message.includes("not in submitted status") ||
    message.includes("Only draft bills") ||
    message.includes("capitalised") ||
    message.includes("quantity_on_hand") ||
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    message.includes("approve") ||
    message.includes("has not been migrated")
  ) {
    return message;
  }
  console.error("Bill action failed:", err);
  return "Something went wrong. Please try again.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bills list page.
 *
 * Note what is NOT passed: a companyId. RLS supplies it, and forgetting it
 * returns zero rows rather than another tenant's payables (§2.2).
 */
export async function listBillsForPage(opts: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  paymentStatus?: string;
  supplierId?: string;
}) {
  const result = await withAuthorizedTenant([], (tx) =>
    billsRepo.searchBills(tx, {
      query: opts.search,
      page: opts.page,
      perPage: opts.limit,
      status: opts.status || undefined,
      paymentStatus: opts.paymentStatus || undefined,
      supplierId: opts.supplierId || undefined,
    }),
  );

  return {
    bills: result.bills,
    pagination: {
      page: result.page,
      total: result.total,
      totalPages: result.totalPages,
    },
  };
}

/** The four figures the list page's cards read. */
export async function getBillsStats() {
  return withAuthorizedTenant([], (tx) => billsRepo.getBillStats(tx));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export async function submitBill(billId: string): Promise<ActionResult> {
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_WRITE_ROLES],
      async (tx, { user }) => billsRepo.submitBill(tx, billId, user.id),
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    return {
      success: true,
      billId,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} submitted for approval`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Approves a bill: posts the purchase entry, admits any stock the bill
 * receives, and records the VAT and WHT — all in one transaction.
 *
 * SEPARATION OF DUTIES is checked here rather than in the database, and that
 * is a deliberate limit rather than an oversight. The rule depends on the
 * actor's ROLE, and roles live in Mongo — there is no users table in Postgres
 * (§10). The base rule alone (`approved_by_id <> submitted_by_id`) could be a
 * CHECK, but only if the override below were dropped, which is a product
 * decision and not one to make silently in a migration.
 *
 * One difference from the reference: it treats SuperAdmin as outranking Admin.
 * bill-actions.js:1088 tests `user.role !== "Admin"`, so a SuperAdmin who
 * submitted a bill cannot approve it while an Admin can — the one place in the
 * codebase where SuperAdmin has less authority than Admin.
 */
export async function approveBill(billId: string): Promise<ActionResult> {
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      async (tx, { user }) => {
        const existing = await billsRepo.getBill(tx, billId);
        if (!existing) throw new Error("Bill not found");

        if (
          existing.submittedById === user.id &&
          !ADMIN_ROLES.includes(user.role)
        ) {
          throw new Error(
            "You cannot approve a bill you submitted. Ask another approver.",
          );
        }

        const ap = await accountsRepo.getSystemAccount(tx, "accounts_payable");
        if (!ap) {
          throw new Error("Accounts Payable system account not configured");
        }
        const vatInput = await accountsRepo.getSystemAccount(tx, "vat_input");
        const whtPayable = await accountsRepo.getSystemAccount(tx, "wht_payable");
        const inventory = await accountsRepo.getSystemAccount(tx, "inventory");
        // Optional: only a three-way-match tenant maps one, and approveBill
        // raises a named error if a line needs it and it is absent.
        const grni = await accountsRepo.getSystemAccount(tx, "grni");

        return billsRepo.approveBill(tx, billId, {
          apAccountId: ap.id,
          vatInputAccountId: vatInput?.id ?? null,
          whtPayableAccountId: whtPayable?.id ?? null,
          inventoryAccountId: inventory?.id ?? null,
          grniAccountId: grni?.id ?? null,
          approvedById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/journal");
    revalidatePath("/dashboard/stocks");
    return {
      success: true,
      billId,
      billNumber: bill.bill.billNumber,
      message: `Bill ${bill.bill.billNumber} approved and posted`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function rejectBill(
  billId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      async (tx, { user }) =>
        billsRepo.rejectBill(tx, billId, user.id, reason),
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    return {
      success: true,
      billId,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} rejected`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Deletes a draft bill.
 *
 * The reference gates this on `isOwner(user, bill.createdBy) || hasRole(...)`.
 * Ownership is not carried here: created_by_id holds a Mongo user id today and
 * the id map does not cover users, so an owner check would compare values that
 * cannot be relied on to match. The role gate is the honest one until users
 * are in Postgres — and it is the stricter of the two, not the looser.
 */
export async function deleteBill(billId: string): Promise<ActionResult> {
  try {
    const { billNumber } = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      (tx) => billsRepo.deleteDraftBill(tx, billId),
    );

    revalidatePath("/dashboard/bills");
    return { success: true, billNumber, message: `Bill ${billNumber} deleted` };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}
