"use server";

import { withAuthorizedTenant } from "../tenant";
import * as grIrRepo from "../repositories/grIr";
import * as billsRepo from "../repositories/bills";
import { rolesFor } from "@/lib/capabilities";

/**
 * GR/IR reconciliation — the reads the screen makes.
 *
 * WHO SEES IT: procurement and finance both, from their own menus, because it
 * is one question asked by two departments. Procurement needs to know which
 * deliveries have not been invoiced; finance needs to know what the clearing
 * account is holding and why. Pointing both at the same figures is the point —
 * a reconciliation where the two sides read different reports is how the
 * arguments start.
 *
 * NOT gated on who may POST anything. Nothing here writes; it is a report, and
 * a report that only its owners may read cannot be reconciled by the people
 * who caused the positions.
 */
const VIEW_ROLES = rolesFor("grir.view");

export async function getGrIrSummaryPg() {
  return withAuthorizedTenant(VIEW_ROLES, (tx) => grIrRepo.getGrIrSummary(tx));
}

export async function getGrIrAgeingPg() {
  return withAuthorizedTenant(VIEW_ROLES, (tx) => grIrRepo.getGrIrAgeing(tx));
}

export async function listGrIrPositionsPg(
  opts: {
    direction?: "awaiting_invoice" | "awaiting_receipt" | "matched" | "all";
    supplierId?: string;
    limit?: number;
  } = {},
) {
  return withAuthorizedTenant(VIEW_ROLES, (tx) =>
    grIrRepo.listGrIrPositions(tx, opts),
  );
}

/**
 * Bills approved against GR/IR whose goods have not been admitted.
 *
 * The document-level view of the awaiting-receipt side, and it catches what
 * the order-line positions cannot: a bill raised with no purchase order still
 * debits GR/IR and still has no receipt behind it. `listBillsAwaitingGRN`
 * reads `used_grni AND NOT inventory_moved`, which is what `approveBill` and
 * `finaliseAcceptance` actually write — so this is a fact about the documents
 * rather than a status somebody has to maintain.
 */
export async function listBillsAwaitingReceiptPg(limit = 100) {
  return withAuthorizedTenant(VIEW_ROLES, (tx) =>
    billsRepo.listBillsAwaitingGRN(tx, limit),
  );
}
