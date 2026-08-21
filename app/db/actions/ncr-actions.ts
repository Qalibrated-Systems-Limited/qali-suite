"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import type { Tx } from "../client";
import {
  NCR_RAISE_ROLES,
  NCR_PROPOSE_ROLES,
  NCR_AUTHORIZE_ROLES,
} from "@/lib/utils/role-gates";
import * as nonconformance from "../repositories/nonconformance";
import * as accountsRepo from "../repositories/accounts";
import {
  nonconformanceSchema,
  toNonconformanceInput,
} from "../validation/procurement";

/**
 * Nonconformance actions on Postgres (§9G, SOP §10.6).
 *
 * The interesting one is `executeNonconformanceDispositionPg`, because in the
 * Mongo module the equivalent posts nothing at all: closeNCR moves stock out
 * of HOLD and carries a comment saying journal-entry posting for return and
 * scrap is "intentionally out of scope here". Goods are written off, they
 * physically leave, and their value stays on the balance sheet.
 *
 * Three hands, and the schema holds them apart: raise, propose, authorise. The
 * role gates say what kind of person may do each; the CHECK constraints in
 * 0051 say that they must be three different people.
 */

export type ActionResult =
  | {
      success: true;
      nonconformanceId?: string;
      ncrNumber?: string;
      journalEntryId?: string | null;
      message?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function revalidateNcr(nonconformanceId?: string, extra: string[] = []) {
  revalidatePath("/dashboard/ncr");
  if (nonconformanceId) revalidatePath(`/dashboard/ncr/${nonconformanceId}`);
  for (const path of extra) revalidatePath(path);
}

/**
 * The three accounts a disposition can touch.
 *
 * Scrapped value lands in Inventory Adjustments (5300) — an expense the chart
 * already provisions, described as the home for stock movements with no source
 * document, which a write-off is. It is deliberately not Inventory: crediting
 * the asset is what the entry DOES, and the debit has to leave the balance
 * sheet or nothing has been written off.
 */
async function resolveDispositionAccounts(tx: Tx) {
  const [inventory, grni, writeOff] = await Promise.all([
    accountsRepo.getSystemAccount(tx, "inventory"),
    accountsRepo.getSystemAccount(tx, "grni"),
    accountsRepo.getSystemAccount(tx, "inventory_adjustments"),
  ]);
  if (!inventory || !grni || !writeOff) {
    const missing = [
      !inventory && "Inventory",
      !grni && "GR/IR Clearing",
      !writeOff && "Inventory Adjustments",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Cannot carry out this disposition: the ${missing} account is not configured for this company.`,
    );
  }
  return {
    inventoryAccountId: inventory.id,
    grniAccountId: grni.id,
    writeOffAccountId: writeOff.id,
  };
}

export async function createNonconformancePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("data") ?? "{}"));
  } catch {
    return { success: false, error: "Could not read the form data" };
  }
  const parsed = nonconformanceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const ncr = await withAuthorizedTenant(
      [...NCR_RAISE_ROLES],
      (tx, { user, companyId }) =>
        nonconformance.createNonconformance(tx, {
          companyId,
          ...toNonconformanceInput(parsed.data),
          createdById: user.id,
          createdByName: user.name,
        }),
    );

    revalidateNcr();
    return {
      success: true,
      nonconformanceId: ncr.id,
      ncrNumber: ncr.ncrNumber,
      message: `Nonconformance ${ncr.ncrNumber} raised`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not raise the nonconformance.") };
  }
}

/**
 * Raises one from a receipt's discrepant lines.
 *
 * The lines it covers are named by id. Mongo copies the product id and matches
 * back through a Map, which resolves against the wrong line whenever a delivery
 * carries the same product twice — two pallets in different condition, which is
 * the reason for the report in the first place.
 */
export async function createNonconformanceFromReceiptPg(
  goodsReceiptId: string,
  input: { title?: string | null; description?: string | null; requiresCar?: boolean } = {},
): Promise<ActionResult> {
  try {
    const ncr = await withAuthorizedTenant([...NCR_RAISE_ROLES], (tx, { user }) =>
      nonconformance.createFromGoodsReceipt(tx, goodsReceiptId, {
        ...input,
        createdById: user.id,
        createdByName: user.name,
      }),
    );

    revalidateNcr(undefined, [`/dashboard/grn/${goodsReceiptId}`]);
    return {
      success: true,
      nonconformanceId: ncr.id,
      ncrNumber: ncr.ncrNumber,
      message: `Nonconformance ${ncr.ncrNumber} raised against the receipt`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not raise the nonconformance.") };
  }
}

export async function proposeDispositionPg(
  nonconformanceId: string,
  dispositionType: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const ncr = await withAuthorizedTenant([...NCR_PROPOSE_ROLES], (tx, { user }) =>
      nonconformance.proposeDisposition(
        tx,
        nonconformanceId,
        dispositionType,
        reason,
        user.id,
        user.name,
      ),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, ncrNumber: ncr.ncrNumber, message: "Disposition proposed" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not propose the disposition.") };
  }
}

/** SOP §10.6: the Managing Director, or delegated authority. Never the proposer. */
export async function authorizeDispositionPg(
  nonconformanceId: string,
  notes?: string | null,
): Promise<ActionResult> {
  try {
    const ncr = await withAuthorizedTenant([...NCR_AUTHORIZE_ROLES], (tx, { user }) =>
      nonconformance.authorizeDisposition(
        tx,
        nonconformanceId,
        user.id,
        user.name,
        notes ?? null,
      ),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, ncrNumber: ncr.ncrNumber, message: "Disposition authorised" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not authorise the disposition.") };
  }
}

/**
 * The disposition is carried out: the goods move, and so does the ledger.
 *
 * Closing means the decision has been EXECUTED. That is why 'repair' releases
 * the goods here rather than leaving them held "until the repair workflow
 * completes" — there is no such workflow, so in Mongo the stock is held
 * indefinitely. An unfinished repair is a nonconformance that is not closed yet.
 */
export async function executeNonconformanceDispositionPg(
  nonconformanceId: string,
  notes?: string | null,
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(
      [...NCR_PROPOSE_ROLES],
      async (tx, { user }) => {
        const accounts = await resolveDispositionAccounts(tx);
        return nonconformance.executeDisposition(tx, nonconformanceId, {
          ...accounts,
          executedById: user.id,
          executedByName: user.name,
          notes: notes ?? null,
        });
      },
    );

    revalidateNcr(nonconformanceId, [
      "/dashboard/stocks",
      "/dashboard/journal",
      "/dashboard/grn",
    ]);
    return {
      success: true,
      ncrNumber: result.nonconformance.ncrNumber,
      journalEntryId: result.entry?.id ?? null,
      message: result.entry
        ? `${result.nonconformance.ncrNumber} closed and posted`
        : `${result.nonconformance.ncrNumber} closed — the goods went back, so nothing was posted`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not carry out the disposition.") };
  }
}

export async function cancelNonconformancePg(
  nonconformanceId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Cancelling a nonconformance needs a reason." };
  }

  try {
    await withAuthorizedTenant([...NCR_PROPOSE_ROLES], (tx, { user }) =>
      nonconformance.cancelNonconformance(
        tx,
        nonconformanceId,
        reason,
        user.id,
        user.name,
      ),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, message: "Nonconformance cancelled" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not cancel the nonconformance.") };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listNonconformancesPg(
  filters: nonconformance.ListNonconformancesFilters = {},
  page = 1,
  pageSize = 20,
) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.listNonconformances(tx, filters, page, pageSize),
  );
}

export async function countNonconformancesPg(
  filters: nonconformance.ListNonconformancesFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.countNonconformances(tx, filters),
  );
}

export async function getNonconformanceDetailPg(nonconformanceId: string) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.getNonconformanceDetail(tx, nonconformanceId),
  );
}

export async function getNonconformanceStatsPg() {
  return withAuthorizedTenant([], (tx) => nonconformance.getNonconformanceStats(tx));
}
