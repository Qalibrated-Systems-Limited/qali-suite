"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import {
  GRN_RECEIVE_ROLES,
  GRN_ACCEPT_SALES_ROLES,
  GRN_ACCEPT_FINANCE_ROLES,
  GRN_REJECT_ROLES,
} from "@/lib/utils/role-gates";
import * as goodsReceipts from "../repositories/goodsReceipts";
import * as accountsRepo from "../repositories/accounts";
import {
  goodsReceiptSchema,
  toGoodsReceiptInput,
  lineDecisionsSchema,
  toLineDecisions,
} from "../validation/procurement";

/**
 * Goods receipt actions on Postgres (§9G).
 *
 * The acceptance path is the one that matters: it admits the stock and posts
 * DR Inventory / CR GR/IR, which is what has been going into the Mongo ledger
 * — and therefore nowhere — since bills were ported with three-way match.
 *
 * SEPARATION OF DUTIES IS ENFORCED TWICE, on purpose. The role gates here say
 * what KIND of person may act: Procurement Officer is deliberately absent from
 * GRN_RECEIVE_ROLES, because raising the order and receiving against it is the
 * classic procurement fraud. Only the row knows WHICH person already acted, so
 * "the receiver cannot sign" and "one person cannot sign both halves" are CHECK
 * constraints in 0050 — unreachable around by a second caller, a script or an
 * import.
 */

export type ActionResult =
  | {
      success: true;
      goodsReceiptId?: string;
      grnNumber?: string;
      journalEntryId?: string | null;
      message?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function parse<T extends { safeParse: (v: unknown) => any }>(
  schema: T,
  formData: FormData,
  key = "data",
) {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get(key) ?? "{}"));
  } catch {
    return { ok: false as const, error: "Could not read the form data" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  return { ok: true as const, data: parsed.data };
}

function revalidateReceipt(goodsReceiptId?: string, extra: string[] = []) {
  revalidatePath("/dashboard/grn");
  if (goodsReceiptId) revalidatePath(`/dashboard/grn/${goodsReceiptId}`);
  for (const path of extra) revalidatePath(path);
}

/**
 * Resolves the two system accounts the acceptance entry needs.
 *
 * Looked up by `system_account`, the same way bills resolve theirs, and a
 * missing one is a hard failure rather than a fallback. Falling back to
 * direct-inventory posting would defeat the very control the tenant switched
 * on — which is the reasoning approveBill already applies to the same pair.
 */
async function resolvePostingAccounts(tx: Parameters<typeof accountsRepo.getSystemAccount>[0]) {
  const [inventory, grni] = await Promise.all([
    accountsRepo.getSystemAccount(tx, "inventory"),
    accountsRepo.getSystemAccount(tx, "grni"),
  ]);
  if (!inventory) {
    throw new Error(
      "No Inventory account is configured for this company, so goods cannot be admitted to the ledger.",
    );
  }
  if (!grni) {
    throw new Error(
      "No GR/IR clearing account is configured for this company. Set one before accepting receipts — it is what the supplier's bill will clear against.",
    );
  }
  return { inventoryAccountId: inventory.id, grniAccountId: grni.id };
}

export async function createGoodsReceiptPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(goodsReceiptSchema, formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    const grn = await withAuthorizedTenant(
      [...GRN_RECEIVE_ROLES],
      (tx, { user, companyId }) =>
        goodsReceipts.createGoodsReceipt(tx, {
          companyId,
          ...toGoodsReceiptInput(parsed.data),
          receivedById: user.id,
          receivedByName: user.name,
          createdById: user.id,
          createdByName: user.name,
        }),
    );

    revalidateReceipt();
    return {
      success: true,
      goodsReceiptId: grn.id,
      grnNumber: grn.grnNumber,
      message: `Goods receipt ${grn.grnNumber} created`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record the receipt.") };
  }
}

/**
 * The storekeeper signs: the goods are physically here.
 *
 * They go on hand and on hold together, so nothing can be issued against them
 * until both sides have accepted. No ledger entry — goods that might still be
 * rejected have not been bought.
 */
export async function submitGoodsReceiptPg(
  goodsReceiptId: string,
): Promise<ActionResult> {
  try {
    const grn = await withAuthorizedTenant([...GRN_RECEIVE_ROLES], (tx, { user }) =>
      goodsReceipts.submitGoodsReceipt(tx, goodsReceiptId, user.id, user.name),
    );
    revalidateReceipt(goodsReceiptId, ["/dashboard/stocks"]);
    return {
      success: true,
      grnNumber: grn.grnNumber,
      message: `${grn.grnNumber} submitted for acceptance`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not submit the receipt.") };
  }
}

/** Records what was accepted, rejected or held, line by line. */
export async function recordLineDecisionsPg(
  goodsReceiptId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(lineDecisionsSchema, formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    await withAuthorizedTenant(
      [...GRN_ACCEPT_SALES_ROLES, ...GRN_ACCEPT_FINANCE_ROLES],
      (tx) =>
        goodsReceipts.recordLineDecisions(
          tx,
          goodsReceiptId,
          toLineDecisions(parsed.data),
        ),
    );
    revalidateReceipt(goodsReceiptId);
    return { success: true, message: "Decisions recorded" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record the decisions.") };
  }
}

/**
 * One side of the two-signature acceptance, and the finalisation once both are in.
 *
 * The SOP requires Sales AND Finance in writing. Signing does not finalise
 * anything on its own — so the two can be given in either order, by two
 * different people, on two different days — and the second signature is what
 * admits the stock and posts the clearing entry.
 */
export async function acceptGoodsReceiptPg(
  goodsReceiptId: string,
  side: "sales" | "finance",
  notes?: string | null,
): Promise<ActionResult> {
  const roles =
    side === "sales" ? GRN_ACCEPT_SALES_ROLES : GRN_ACCEPT_FINANCE_ROLES;

  try {
    const result = await withAuthorizedTenant([...roles], async (tx, { user }) => {
      const grn = await goodsReceipts.signAcceptance(
        tx,
        goodsReceiptId,
        side,
        user.id,
        user.name,
        notes ?? null,
      );

      if (!grn.salesAcceptedAt || !grn.financeAcceptedAt) {
        return { grn, entry: null, finalised: false as const };
      }

      const accounts = await resolvePostingAccounts(tx);
      const finalised = await goodsReceipts.finaliseAcceptance(tx, goodsReceiptId, {
        ...accounts,
        finalisedById: user.id,
        finalisedByName: user.name,
      });
      return { grn: finalised.goodsReceipt, entry: finalised.entry, finalised: true as const };
    });

    revalidateReceipt(goodsReceiptId, [
      "/dashboard/stocks",
      "/dashboard/journal",
      "/dashboard/bills",
    ]);

    return {
      success: true,
      grnNumber: result.grn.grnNumber,
      journalEntryId: result.entry?.id ?? null,
      message: result.finalised
        ? `${result.grn.grnNumber} accepted — stock admitted and posted`
        : `${side === "sales" ? "Sales" : "Finance"} acceptance recorded. Waiting on the other side.`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not accept the receipt.") };
  }
}

/** The whole delivery is refused: it all goes back, and nothing is posted. */
export async function rejectGoodsReceiptPg(
  goodsReceiptId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Rejecting a delivery needs a reason." };
  }

  try {
    const grn = await withAuthorizedTenant([...GRN_REJECT_ROLES], (tx, { user }) =>
      goodsReceipts.rejectGoodsReceipt(tx, goodsReceiptId, reason, user.id, user.name),
    );
    revalidateReceipt(goodsReceiptId, ["/dashboard/stocks"]);
    return { success: true, grnNumber: grn.grnNumber, message: "Delivery rejected" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not reject the receipt.") };
  }
}

/** Raised in error. Drafts only — the state machine in 0050 enforces it. */
export async function voidGoodsReceiptPg(
  goodsReceiptId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Voiding a receipt needs a reason." };
  }

  try {
    await withAuthorizedTenant([...GRN_REJECT_ROLES], (tx, { user }) =>
      goodsReceipts.voidGoodsReceipt(tx, goodsReceiptId, reason, user.id, user.name),
    );
    revalidateReceipt(goodsReceiptId);
    return { success: true, message: "Receipt voided" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not void the receipt.") };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listGoodsReceiptsPg(
  filters: goodsReceipts.ListGoodsReceiptsFilters = {},
  page = 1,
  pageSize = 20,
) {
  return withAuthorizedTenant([], (tx) =>
    goodsReceipts.listGoodsReceipts(tx, filters, page, pageSize),
  );
}

export async function countGoodsReceiptsPg(
  filters: goodsReceipts.ListGoodsReceiptsFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    goodsReceipts.countGoodsReceipts(tx, filters),
  );
}

export async function getGoodsReceiptDetailPg(goodsReceiptId: string) {
  return withAuthorizedTenant([], (tx) =>
    goodsReceipts.getGoodsReceiptDetail(tx, goodsReceiptId),
  );
}

export async function getGoodsReceiptStatsPg() {
  return withAuthorizedTenant([], (tx) => goodsReceipts.getGoodsReceiptStats(tx));
}

export async function getGoodsReceiptsForBillPg(billId: string) {
  return withAuthorizedTenant([], (tx) =>
    goodsReceipts.getGoodsReceiptsForBill(tx, billId),
  );
}

/**
 * The GR/IR reconciliation.
 *
 * The report that could not exist while half its evidence was in Mongo: every
 * order line where the value received and the value billed disagree. The
 * balance of the clearing account should equal the sum of this list, and
 * anything else is a discrepancy somebody needs to see.
 */
export async function getGrIrOpenItemsPg(limit = 200) {
  return withAuthorizedTenant([], (tx) => goodsReceipts.getGrIrOpenItems(tx, limit));
}
