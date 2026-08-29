import { and, asc, eq, sql } from "drizzle-orm";
import { anyOf, likeContains } from "./sqlHelpers";
import type { Tx } from "../client";
import { goodsReceipts, goodsReceiptLines } from "../schema/goodsReceipts";
import { bills } from "../schema/bills";
import { createJournalEntry } from "./journal";
import { recordMovement } from "./stockMovements";
import {
  receiveStockToHold,
  acceptStockFromHold,
  rejectStockFromHold,
  recostFromAcceptedReceipt,
} from "./products";

/**
 * Goods receipts (0050) — and the clearing entry §9G is about.
 *
 * Three-way match shipped with bills in 0015: a stocked line on an approved
 * bill posts to GR/IR when `require_grn` is on, and waits for the goods. The
 * document that admits them stayed in Mongo and posted its clearing entry to
 * the Mongo ledger, so the clearing account could only grow. This is the other
 * half.
 *
 *   goods first (PO)     accept():  DR Inventory  CR GR/IR
 *                        approve(): DR GR/IR      CR Accounts Payable
 *
 *   bill first (strict)  approve(): DR GR/IR      CR Accounts Payable
 *                        accept():  DR Inventory  CR GR/IR
 *
 * Either order nets to zero. `gr_ir_open_items` lists the ones that have not.
 *
 * Accounts are passed in, not looked up here — the same division bills draws,
 * so the action layer owns "which account is GR/IR for this tenant" and the
 * repository owns what gets posted to it.
 */

export interface GoodsReceiptLineInput {
  purchaseOrderLineId?: string | null;
  productId: string;
  productName: string;
  productSku?: string | null;
  description: string;
  unit?: string | null;
  expectedQuantity?: string;
  receivedQuantity: string;
  /**
   * What these goods cost. Frozen now, so acceptance posts a number that was
   * decided when somebody could still see the delivery note — rather than
   * hunting the bill for a line with a matching product id, which is what
   * postGRNAcceptanceJournal does and which picks the wrong line whenever a
   * bill carries the same product twice.
   */
  unitCost?: string;
  packagingCondition?: string;
  physicalCondition?: string;
  inspectionNotes?: string | null;
  photoUrls?: string[];
  storageLocation?: string | null;
}

export interface CreateGoodsReceiptInput {
  companyId: string;
  sourceType: "purchase_order" | "bill" | "unscheduled";
  purchaseOrderId?: string | null;
  billId?: string | null;
  proformaInvoiceNumber?: string | null;
  packingListNumber?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  receivedDate: string;
  receivedById?: string | null;
  receivedByName?: string | null;
  notes?: string | null;
  discrepancyNotes?: string | null;
  lines: GoodsReceiptLineInput[];
  createdById?: string | null;
  createdByName?: string | null;
}

export async function createGoodsReceipt(
  tx: Tx,
  input: CreateGoodsReceiptInput,
) {
  if (!input.lines?.length) {
    throw new Error("A goods receipt needs at least one line.");
  }

  const [{ grn_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'grn')
    ) AS grn_number`,
  )) as unknown as Array<{ grn_number: string }>;

  const [grn] = await tx
    .insert(goodsReceipts)
    .values({
      companyId: input.companyId,
      grnNumber: grn_number,
      sourceType: input.sourceType,
      purchaseOrderId: input.purchaseOrderId ?? null,
      billId: input.billId ?? null,
      proformaInvoiceNumber: input.proformaInvoiceNumber ?? null,
      packingListNumber: input.packingListNumber ?? null,
      supplierId: input.supplierId ?? null,
      supplierName: input.supplierName ?? null,
      receivedDate: input.receivedDate,
      receivedById: input.receivedById ?? null,
      receivedByName: input.receivedByName ?? null,
      notes: input.notes ?? null,
      discrepancyNotes: input.discrepancyNotes ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  let n = 0;
  for (const line of input.lines) {
    n++;
    // The over-receipt tolerance trigger fires here, cumulatively across every
    // live receipt against the order line. Its message names the order and the
    // running total, so a rejection is actionable.
    await tx.insert(goodsReceiptLines).values({
      companyId: input.companyId,
      goodsReceiptId: grn.id,
      lineNumber: n,
      purchaseOrderLineId: line.purchaseOrderLineId ?? null,
      productId: line.productId,
      productName: line.productName,
      productSku: line.productSku ?? null,
      description: line.description,
      unit: line.unit ?? "pcs",
      expectedQuantity: line.expectedQuantity ?? "0",
      receivedQuantity: line.receivedQuantity,
      unitCost: line.unitCost ?? "0",
      packagingCondition: line.packagingCondition ?? "good",
      physicalCondition: line.physicalCondition ?? "good",
      inspectionNotes: line.inspectionNotes ?? null,
      photoUrls: line.photoUrls ?? [],
      storageLocation: line.storageLocation ?? null,
    });
  }

  return grn;
}

export async function getGoodsReceipt(tx: Tx, goodsReceiptId: string) {
  const [grn] = await tx
    .select()
    .from(goodsReceipts)
    .where(eq(goodsReceipts.id, goodsReceiptId));
  return grn ?? null;
}

async function getLines(tx: Tx, goodsReceiptId: string) {
  return tx
    .select()
    .from(goodsReceiptLines)
    .where(eq(goodsReceiptLines.goodsReceiptId, goodsReceiptId))
    .orderBy(asc(goodsReceiptLines.lineNumber));
}

export async function getGoodsReceiptDetail(tx: Tx, goodsReceiptId: string) {
  const grn = await getGoodsReceipt(tx, goodsReceiptId);
  if (!grn) return null;

  const lines = await getLines(tx, goodsReceiptId);
  const [state] = (await tx.execute(sql`
    SELECT * FROM goods_receipt_state WHERE goods_receipt_id = ${goodsReceiptId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  // Nonconformances raised against this receipt. Mongo keeps `grn.ncrId`, a
  // single back-pointer, so the second NCR on a receipt overwrites the first.
  const ncrs = (await tx.execute(sql`
    SELECT n.id, n.ncr_number, n.status, n.category, n.disposition_type, n.title
      FROM nonconformances n
     WHERE n.goods_receipt_id = ${goodsReceiptId}::uuid
     ORDER BY n.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;

  // What the receipt was raised against, by its number — what the PDF prints
  // and what a storekeeper checks the delivery note against.
  const [source] = (await tx.execute(sql`
    SELECT COALESCE(po.po_number, b.bill_number) AS reference
      FROM goods_receipts g
      LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id
      LEFT JOIN bills b            ON b.id = g.bill_id
     WHERE g.id = ${goodsReceiptId}::uuid
  `)) as unknown as Array<{ reference: string | null }>;

  return {
    ...grn,
    lines,
    state: state ?? null,
    nonconformances: ncrs,
    sourceReference: source?.reference ?? null,
  };
}

/**
 * The display status the screens expect.
 *
 * Anti-corruption layer, same as `displayStatus` for orders and for the same
 * reason. 0050 keeps `status` as what a person DID — draft, submitted,
 * finalised, voided — and derives what the acceptance DECIDED, because Mongo
 * stored 'accepted', 'partially_accepted' and 'rejected' on the header beside
 * per-line decisions that said the same thing, and the two could disagree.
 *
 * The screens still read one string, so the two are recombined here: a
 * finalised receipt reports its outcome, anything else reports its status.
 */
export function displayStatus(row: {
  status?: unknown;
  outcome?: unknown;
}): string {
  const status = String(row.status ?? "draft");
  if (status !== "finalised") return status;
  const outcome = String(row.outcome ?? "accepted");
  return outcome === "voided" ? "voided" : outcome;
}

/**
 * A goods receipt as the detail page renders it.
 *
 * Shaped to the page — `source.type`, `lines[].receivedQty`,
 * `salesAccepted.{name,at,notes}` — on the `getBillDetail` precedent, so the
 * markup does not change with the data source.
 *
 * `hasDiscrepancy` is read from the lines rather than from a stored flag, and
 * the two sign-off stamps are assembled from their own columns: the SOP wants
 * Sales AND Finance in writing, so each is a separate auditable fact rather
 * than one "approved" boolean.
 */
export async function getGoodsReceiptForDisplay(
  tx: Tx,
  goodsReceiptId: string,
) {
  const detail = await getGoodsReceiptDetail(tx, goodsReceiptId);
  if (!detail) return null;

  const state = (detail.state ?? {}) as Record<string, any>;

  const stamp = (
    id: string | null,
    name: string | null,
    at: Date | null,
    notes: string | null,
  ) => (at ? { id, name: name ?? id, at, notes } : null);

  return {
    _id: detail.id,
    id: detail.id,
    grnNumber: detail.grnNumber,

    status: displayStatus({ status: detail.status, outcome: state.outcome }),
    workflowStatus: detail.status,
    outcome: state.outcome ?? "pending",

    source: {
      type: detail.sourceType,
      billId: detail.billId,
      purchaseOrderId: detail.purchaseOrderId,
      proformaInvoiceNumber: detail.proformaInvoiceNumber,
      packingListNumber: detail.packingListNumber,
      /** The order or bill number this receives against. */
      reference: detail.sourceReference,
    },

    supplier: detail.supplierId || detail.supplierName
      ? { partyId: detail.supplierId, _id: detail.supplierId, name: detail.supplierName }
      : null,

    receivedDate: detail.receivedDate,
    receivedBy: detail.receivedByName
      ? { id: detail.receivedById, name: detail.receivedByName }
      : null,

    // Derived from the lines (0050). Mongo stores both and neither is
    // recomputed when a line changes.
    hasDiscrepancy: Boolean(state.has_discrepancy),
    hasOverReceipt: Boolean(state.has_over_receipt),
    discrepancyNotes: detail.discrepancyNotes,
    notes: detail.notes,

    salesAccepted: stamp(
      detail.salesAcceptedById,
      detail.salesAcceptedByName,
      detail.salesAcceptedAt,
      detail.salesAcceptanceNotes,
    ),
    financeAccepted: stamp(
      detail.financeAcceptedById,
      detail.financeAcceptedByName,
      detail.financeAcceptedAt,
      detail.financeAcceptanceNotes,
    ),
    acceptedAt: detail.acceptedAt,

    rejectedAt: detail.rejectedAt,
    rejectedBy: detail.rejectedByName ? { name: detail.rejectedByName } : null,
    // The page reads `rejectReason`; the column is `rejection_reason`.
    rejectReason: detail.rejectionReason,
    voidedAt: detail.voidedAt,
    voidReason: detail.voidReason,

    /** The acceptance posting, which Mongo creates and records nowhere. */
    journalEntryId: detail.journalEntryId,

    totals: {
      received: Number(state.received_quantity ?? 0),
      accepted: Number(state.accepted_quantity ?? 0),
      rejected: Number(state.rejected_quantity ?? 0),
      acceptedValue: Number(state.accepted_value ?? 0),
    },

    lines: detail.lines.map((l) => ({
      _id: l.id,
      id: l.id,
      lineNumber: l.lineNumber,
      purchaseOrderLineId: l.purchaseOrderLineId,
      productId: l.productId,
      sku: l.productSku,
      productName: l.productName,
      description: l.description,
      unit: l.unit,
      expectedQty: Number(l.expectedQuantity),
      receivedQty: Number(l.receivedQuantity),
      acceptedQty: Number(l.acceptedQuantity),
      rejectedQty: Number(l.rejectedQuantity ?? 0),
      unitCost: Number(l.unitCost),
      acceptedValue: Number(l.acceptedValue ?? 0),
      packagingCondition: l.packagingCondition,
      physicalCondition: l.physicalCondition,
      inspectionNotes: l.inspectionNotes,
      photoUrls: l.photoUrls,
      storageLocation: l.storageLocation,
      lineStatus: l.lineStatus,
      rejectReason: l.rejectReason,
    })),

    /**
     * Every nonconformance raised against this receipt. Mongo keeps a single
     * `grn.ncrId`, so the second one overwrote the first.
     */
    nonconformances: detail.nonconformances,

    createdAt: detail.createdAt,
    createdBy: detail.createdByName ? { name: detail.createdByName } : null,
  };
}

/** The list rows, in the shape the GRN index reads. */
export async function listGoodsReceiptsForDisplay(
  tx: Tx,
  filters: ListGoodsReceiptsFilters = {},
  page = 1,
  pageSize = 20,
) {
  const rows = await listGoodsReceipts(tx, filters, page, pageSize);
  if (!rows.length) return [];

  // The index shows a per-receipt line count and how many are discrepant, so
  // the counts come back with the rows rather than as a query per row.
  const ids = rows.map((r) => String(r.id));
  const counts = (await tx.execute(sql`
    SELECT goods_receipt_id,
           COUNT(*)::int AS lines,
           COUNT(*) FILTER (
             WHERE received_quantity <> expected_quantity
                OR packaging_condition <> 'good'
                OR physical_condition <> 'good'
           )::int AS discrepant
      FROM goods_receipt_lines
     WHERE goods_receipt_id = ${anyOf(ids, "uuid[]")}
     GROUP BY goods_receipt_id
  `)) as unknown as Array<{ goods_receipt_id: string; lines: number; discrepant: number }>;
  const byId = new Map(counts.map((c) => [c.goods_receipt_id, c]));

  return rows.map((r: Record<string, any>) => {
    const c = byId.get(String(r.id)) ?? { lines: 0, discrepant: 0 };
    return {
      _id: r.id,
      id: r.id,
      grnNumber: r.grn_number,
      status: displayStatus(r),
      workflowStatus: r.status,
      outcome: r.outcome,
      source: {
        type: r.source_type,
        billId: r.bill_id,
        purchaseOrderId: r.purchase_order_id,
      },
      supplier: r.supplier_name ? { partyId: r.supplier_id, name: r.supplier_name } : null,
      receivedDate: r.received_date,
      hasDiscrepancy: Boolean(r.has_discrepancy),
      acceptedValue: Number(r.accepted_value ?? 0),
      // The index reads `lines.length` and filters the discrepant ones; it
      // never reads a line's contents, so it gets counts rather than rows.
      lines: Array.from({ length: c.lines }, (_, i) => ({
        _id: `${r.id}:${i}`,
        hasDiscrepancy: i < c.discrepant,
      })),
    };
  });
}

export interface ListGoodsReceiptsFilters {
  status?: string | string[] | null;
  sourceType?: string | null;
  supplierId?: string | null;
  purchaseOrderId?: string | null;
  billId?: string | null;
  search?: string | null;
  /** Receipts whose lines disagree with what was expected. Derived. */
  discrepanciesOnly?: boolean;
}

function listConditions(filters: ListGoodsReceiptsFilters) {
  const parts = [sql`TRUE`];
  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (statuses.length) parts.push(sql`grn.status = ${anyOf(statuses, "text[]")}`);
  }
  if (filters.sourceType) parts.push(sql`grn.source_type = ${filters.sourceType}`);
  if (filters.supplierId)
    parts.push(sql`grn.supplier_id = ${filters.supplierId}::uuid`);
  if (filters.purchaseOrderId)
    parts.push(sql`grn.purchase_order_id = ${filters.purchaseOrderId}::uuid`);
  if (filters.billId) parts.push(sql`grn.bill_id = ${filters.billId}::uuid`);
  if (filters.discrepanciesOnly) parts.push(sql`st.has_discrepancy`);
  if (filters.search) {
    const term = likeContains(filters.search);
    parts.push(
      sql`(grn.grn_number ILIKE ${term} OR grn.supplier_name ILIKE ${term}
           OR grn.packing_list_number ILIKE ${term} OR grn.notes ILIKE ${term})`,
    );
  }
  return sql.join(parts, sql` AND `);
}

export async function listGoodsReceipts(
  tx: Tx,
  filters: ListGoodsReceiptsFilters = {},
  page = 1,
  pageSize = 20,
) {
  const limit = Math.min(Math.max(pageSize, 1), 200);
  const offset = Math.max(page - 1, 0) * limit;
  return (await tx.execute(sql`
    SELECT grn.*, st.outcome, st.has_discrepancy, st.has_over_receipt,
           st.received_quantity, st.accepted_quantity, st.rejected_quantity,
           st.accepted_value
      FROM goods_receipts grn
      JOIN goods_receipt_state st ON st.goods_receipt_id = grn.id
     WHERE ${listConditions(filters)}
     ORDER BY grn.received_date DESC, grn.grn_number DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;
}

export async function countGoodsReceipts(
  tx: Tx,
  filters: ListGoodsReceiptsFilters = {},
) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM goods_receipts grn
      JOIN goods_receipt_state st ON st.goods_receipt_id = grn.id
     WHERE ${listConditions(filters)}
  `)) as unknown as Array<{ n: number }>;
  return row?.n ?? 0;
}

export async function getGoodsReceiptStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                                                   AS total,
           COUNT(*) FILTER (WHERE grn.status = 'draft')::int               AS draft,
           COUNT(*) FILTER (WHERE grn.status = 'pending_acceptance')::int  AS awaiting_acceptance,
           COUNT(*) FILTER (WHERE st.outcome = 'accepted')::int            AS accepted,
           COUNT(*) FILTER (WHERE st.outcome = 'partially_accepted')::int  AS partially_accepted,
           COUNT(*) FILTER (WHERE st.outcome = 'rejected')::int            AS rejected,
           COUNT(*) FILTER (WHERE st.has_discrepancy)::int                 AS with_discrepancy,
           COALESCE(SUM(st.accepted_value), 0)::text                       AS accepted_value
      FROM goods_receipts grn
      JOIN goods_receipt_state st ON st.goods_receipt_id = grn.id
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

/** Receipts against a bill — what the three-way match is waiting on. */
export async function getGoodsReceiptsForBill(tx: Tx, billId: string) {
  return listGoodsReceipts(tx, { billId }, 1, 200);
}

/** The GR/IR reconciliation: every position where received and billed disagree. */
export async function getGrIrOpenItems(tx: Tx, limit = 200) {
  return (await tx.execute(sql`
    SELECT * FROM gr_ir_open_items
     ORDER BY ABS(uninvoiced_value) DESC
     LIMIT ${Math.min(limit, 1000)}
  `)) as unknown as Array<Record<string, unknown>>;
}

/**
 * The storekeeper signs: the goods are physically here.
 *
 * They go on hand AND on hold together, so `quantity_available` — a generated
 * column — does not move. Nothing may be issued against them until Sales and
 * Finance have both accepted, which is the SOP's rule and is now also the
 * arithmetic's.
 *
 * No ledger entry yet. Goods that might still be rejected have not been bought.
 */
export async function submitGoodsReceipt(
  tx: Tx,
  goodsReceiptId: string,
  submittedById?: string | null,
  submittedByName?: string | null,
) {
  const grn = await getGoodsReceipt(tx, goodsReceiptId);
  if (!grn) throw new Error("Goods receipt not found");
  if (grn.status !== "draft") {
    throw new Error(
      `Only a draft goods receipt can be submitted (this one is ${grn.status}).`,
    );
  }

  const lines = await getLines(tx, goodsReceiptId);
  for (const line of lines) {
    if (Number(line.receivedQuantity) <= 0) continue;
    // The movement is recorded HERE, not at acceptance, because this is where
    // `quantity_on_hand` actually moves — and 0014's constraint requires an
    // inbound movement to raise the level by exactly its quantity. Mongo
    // records it at acceptance and then hand-computes previousStock as
    // "currentOnHand - acceptedQty" to paper over the same mismatch.
    //
    // The accounting link is attached when the receipt is accepted; until then
    // the goods are here but not bought.
    await recordMovement(tx, {
      companyId: grn.companyId,
      productId: line.productId,
      movementType: "purchase",
      direction: "in",
      quantity: line.receivedQuantity,
      unitCost: line.unitCost,
      sourceReference: grn.grnNumber,
      performedById: submittedById ?? null,
      performedByName: submittedByName ?? null,
    });
    await receiveStockToHold(tx, line.productId, line.receivedQuantity);
  }

  const [updated] = await tx
    .update(goodsReceipts)
    .set({
      status: "pending_acceptance",
      lastModifiedById: submittedById ?? null,
      lastModifiedByName: submittedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(goodsReceipts.id, goodsReceiptId))
    .returning();
  return updated;
}

export interface LineDecision {
  goodsReceiptLineId: string;
  acceptedQuantity: string;
  /** 'hold' parks the line for an NCR disposition rather than deciding it. */
  lineStatus?: "accepted" | "rejected" | "hold";
  rejectReason?: string | null;
}

/**
 * One side of the two-signature acceptance.
 *
 * The SOP requires Sales AND Finance. Recording a signature does not finalise
 * anything — `finaliseAcceptance` does, once both are present — so the two can
 * be given in either order, by two different people, on two different days.
 * That the signer is neither the receiver nor the other signatory is a CHECK
 * constraint in 0050, so it holds regardless of which caller gets here.
 */
export async function signAcceptance(
  tx: Tx,
  goodsReceiptId: string,
  side: "sales" | "finance",
  signedById: string,
  signedByName?: string | null,
  notes?: string | null,
) {
  const grn = await getGoodsReceipt(tx, goodsReceiptId);
  if (!grn) throw new Error("Goods receipt not found");
  if (grn.status !== "pending_acceptance") {
    throw new Error(
      `A ${grn.status} goods receipt is not awaiting acceptance.`,
    );
  }

  const already =
    side === "sales" ? grn.salesAcceptedById : grn.financeAcceptedById;
  if (already) {
    throw new Error(`The ${side} side has already signed this receipt.`);
  }

  const patch =
    side === "sales"
      ? {
          salesAcceptedById: signedById,
          salesAcceptedByName: signedByName ?? null,
          salesAcceptedAt: new Date(),
          salesAcceptanceNotes: notes ?? null,
        }
      : {
          financeAcceptedById: signedById,
          financeAcceptedByName: signedByName ?? null,
          financeAcceptedAt: new Date(),
          financeAcceptanceNotes: notes ?? null,
        };

  const [updated] = await tx
    .update(goodsReceipts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(goodsReceipts.id, goodsReceiptId))
    .returning();
  return updated;
}

/** Records what was accepted, rejected or held, line by line. */
export async function recordLineDecisions(
  tx: Tx,
  goodsReceiptId: string,
  decisions: LineDecision[],
) {
  for (const decision of decisions) {
    const status =
      decision.lineStatus ??
      (Number(decision.acceptedQuantity) > 0 ? "accepted" : "rejected");
    await tx
      .update(goodsReceiptLines)
      .set({
        acceptedQuantity: decision.acceptedQuantity,
        lineStatus: status,
        rejectReason: decision.rejectReason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(goodsReceiptLines.id, decision.goodsReceiptLineId));
  }
}

export interface FinaliseAcceptanceOptions {
  inventoryAccountId: string;
  grniAccountId: string;
  finalisedById: string;
  finalisedByName?: string | null;
}

/**
 * Both signatures are in: admit the goods and post the entry.
 *
 * DR Inventory per accepted line, one netting CR to GR/IR. For a bill-sourced
 * receipt that credit CLEARS what the bill's approval debited; for a
 * PO-sourced one it OPENS a position the bill will clear. Same entry, and the
 * direction of the pairing is the only thing that differs — which is why the
 * bill also gets `inventory_moved = true` here, so `listBillsAwaitingGRN` stops
 * reporting it as outstanding.
 *
 * Rejected quantity leaves on hand and hold together. Lines parked on 'hold'
 * stay held: their disposition is the NCR's decision (0051), and nothing is
 * released for use before it is authorised.
 *
 * Everything is one transaction. `inventoryApplied` — the per-line boolean
 * Mongo uses to make this idempotent "on retry / replay" — is not needed and
 * is not here; the receipt's own status machine is what stops it twice.
 */
export async function finaliseAcceptance(
  tx: Tx,
  goodsReceiptId: string,
  opts: FinaliseAcceptanceOptions,
) {
  const grn = await getGoodsReceipt(tx, goodsReceiptId);
  if (!grn) throw new Error("Goods receipt not found");
  if (grn.status !== "pending_acceptance") {
    throw new Error(`A ${grn.status} goods receipt cannot be finalised.`);
  }
  if (!grn.salesAcceptedAt || !grn.financeAcceptedAt) {
    const missing = !grn.salesAcceptedAt ? "Sales" : "Finance";
    throw new Error(
      `${missing} has not signed this receipt yet. The SOP requires both.`,
    );
  }

  /**
   * A line nobody decided on is accepted in full.
   *
   * Both signatories have signed the receipt, and what the receipt RECORDS is
   * what arrived — so silence on a line means nobody objected to it, not that
   * nothing was accepted. Rejecting or holding a line is the deliberate act,
   * and `recordLineDecisions` is where it is made.
   *
   * This is also the source's behaviour: acceptGRN takes `lineDecisions = null`
   * and falls back to `decision?.acceptedQty ?? line.receivedQty`, and the UI
   * passes null on the ordinary path. Without it, accepting a receipt through
   * the buttons would admit nothing, post no entry, and strand the goods on
   * hold — which is what the absence of a caller for recordLineDecisions
   * revealed.
   */
  await tx
    .update(goodsReceiptLines)
    .set({
      acceptedQuantity: sql`${goodsReceiptLines.receivedQuantity}`,
      lineStatus: "accepted",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(goodsReceiptLines.goodsReceiptId, goodsReceiptId),
        eq(goodsReceiptLines.lineStatus, "pending"),
      ),
    );

  const lines = await getLines(tx, goodsReceiptId);

  const jeLines: Array<{
    accountId: string;
    debit?: string;
    credit?: string;
    description?: string | null;
  }> = [];
  let total = 0;

  // Lines parked on 'hold' are skipped entirely: still on hold, still not
  // issuable, and not yet bought. Their disposition is the NCR's decision
  // (0051), and nothing is released for use before it is authorised.
  const decided = lines.filter((l) => l.lineStatus !== "hold");

  // ── 1. What was refused goes back, BEFORE anything is re-costed ──────────
  // Order matters. The re-cost below divides by `quantity_on_hand`, which
  // still carries the rejected units until they leave — costing 35 accepted
  // units against a level of 40 gives 43.75 for goods that cost 50.
  for (const line of decided) {
    const rejected = Number(line.rejectedQuantity ?? "0");
    if (rejected <= 0) continue;
    await recordMovement(tx, {
      companyId: grn.companyId,
      productId: line.productId,
      // Not 'damage': goods refused on arrival were never ours to write off.
      movementType: "adjustment",
      direction: "out",
      quantity: String(rejected),
      unitCost: line.unitCost,
      sourceReference: `${grn.grnNumber} (rejected)`,
      performedById: opts.finalisedById,
      performedByName: opts.finalisedByName ?? null,
    });
    await rejectStockFromHold(tx, line.productId, String(rejected));
  }

  // ── 2. What was accepted becomes issuable, and re-costs the product ──────
  // Grouped by product, so a receipt carrying the same product on two lines at
  // two prices blends both into one weighted average instead of costing the
  // first against a level that already includes the second.
  const byProduct = new Map<string, { quantity: number; value: number }>();

  for (const line of decided) {
    const accepted = Number(line.acceptedQuantity);
    if (accepted <= 0) continue;

    const bucket = byProduct.get(line.productId) ?? { quantity: 0, value: 0 };
    bucket.quantity += accepted;
    bucket.value += Number(line.acceptedValue ?? "0");
    byProduct.set(line.productId, bucket);

    const value = Number(line.acceptedValue ?? "0");
    if (value > 0) {
      total += value;
      jeLines.push({
        accountId: opts.inventoryAccountId,
        debit: line.acceptedValue!,
        description: `Inventory admitted via ${grn.grnNumber} — ${line.description}`,
      });
    }
  }

  for (const [productId, bucket] of byProduct) {
    if (bucket.quantity <= 0) continue;
    await acceptStockFromHold(tx, productId, bucket.quantity.toFixed(4));
    await recostFromAcceptedReceipt(
      tx,
      productId,
      bucket.quantity.toFixed(4),
      (bucket.value / bucket.quantity).toFixed(4),
      grn.receivedDate,
    );
  }

  let entry = null;
  if (total > 0) {
    jeLines.push({
      accountId: opts.grniAccountId,
      credit: total.toFixed(4),
      description: grn.billId
        ? `GR/IR clearing — ${grn.grnNumber}`
        : `GR/IR (goods received, not yet invoiced) — ${grn.grnNumber}`,
    });

    entry = await createJournalEntry(tx, {
      companyId: grn.companyId,
      entryDate: grn.receivedDate,
      entryType: "goods_receipt",
      description: `Goods Receipt ${grn.grnNumber} — admitted to inventory`,
      reference: grn.grnNumber,
      partyType: grn.supplierId ? "supplier" : null,
      partyId: grn.supplierId ?? null,
      sourceType: "goods_receipt",
      sourceId: grn.id,
      lines: jeLines,
      createdById: opts.finalisedById,
      postImmediately: true,
    });
  }

  // The movements were written when the goods landed; this is where they stop
  // being unaccounted-for stock and gain the entry that bought them.
  if (entry) {
    await tx.execute(sql`
      UPDATE stock_movements
         SET journal_entry_id = ${entry.id}::uuid, updated_at = now()
       WHERE company_id = ${grn.companyId}::uuid
         AND source_reference = ${grn.grnNumber}
         AND direction = 'in'
         AND journal_entry_id IS NULL
    `);
  }

  // The bill's goods have arrived. Without this `listBillsAwaitingGRN` keeps
  // reporting it, and cancelBill keeps believing there is no stock to return.
  if (grn.billId) {
    await tx
      .update(bills)
      .set({ inventoryMoved: true, updatedAt: new Date() })
      .where(eq(bills.id, grn.billId));
  }

  const [updated] = await tx
    .update(goodsReceipts)
    .set({
      status: "finalised",
      acceptedAt: new Date(),
      journalEntryId: entry?.id ?? null,
      lastModifiedById: opts.finalisedById,
      lastModifiedByName: opts.finalisedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(goodsReceipts.id, goodsReceiptId))
    .returning();

  return { goodsReceipt: updated, entry };
}

/**
 * The whole delivery is refused: it all goes back.
 *
 * Every line is rejected, the stock leaves hand and hold together, and no
 * entry is posted because nothing was bought. Finalised, not voided — a
 * rejection is a thing that happened and the paperwork has to show it.
 */
export async function rejectGoodsReceipt(
  tx: Tx,
  goodsReceiptId: string,
  reason: string,
  rejectedById: string,
  rejectedByName?: string | null,
) {
  if (!reason?.trim()) {
    throw new Error("Rejecting a delivery needs a reason.");
  }

  const grn = await getGoodsReceipt(tx, goodsReceiptId);
  if (!grn) throw new Error("Goods receipt not found");
  if (grn.status !== "pending_acceptance") {
    throw new Error(`A ${grn.status} goods receipt cannot be rejected.`);
  }
  if (grn.createdById && grn.createdById === rejectedById) {
    throw new Error(
      "You cannot reject a receipt you raised. Ask another approver — voiding is for drafts.",
    );
  }

  const lines = await getLines(tx, goodsReceiptId);
  for (const line of lines) {
    if (Number(line.receivedQuantity) > 0) {
      await recordMovement(tx, {
        companyId: grn.companyId,
        productId: line.productId,
        movementType: "adjustment",
        direction: "out",
        quantity: line.receivedQuantity,
        unitCost: line.unitCost,
        sourceReference: `${grn.grnNumber} (rejected)`,
        performedById: rejectedById,
        performedByName: rejectedByName ?? null,
      });
      await rejectStockFromHold(tx, line.productId, line.receivedQuantity);
    }
    await tx
      .update(goodsReceiptLines)
      .set({
        acceptedQuantity: "0",
        lineStatus: "rejected",
        rejectReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(goodsReceiptLines.id, line.id));
  }

  const [updated] = await tx
    .update(goodsReceipts)
    .set({
      status: "finalised",
      rejectedAt: new Date(),
      rejectedById,
      rejectedByName: rejectedByName ?? null,
      rejectionReason: reason,
      lastModifiedById: rejectedById,
      lastModifiedByName: rejectedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(goodsReceipts.id, goodsReceiptId))
    .returning();
  return updated;
}

/** Raised in error. Drafts only — the state machine in 0050 enforces it. */
export async function voidGoodsReceipt(
  tx: Tx,
  goodsReceiptId: string,
  reason: string,
  voidedById: string,
  voidedByName?: string | null,
) {
  if (!reason?.trim()) throw new Error("Voiding a receipt needs a reason.");

  const [updated] = await tx
    .update(goodsReceipts)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidedById,
      voidedByName: voidedByName ?? null,
      voidReason: reason,
      lastModifiedById: voidedById,
      updatedAt: new Date(),
    })
    .where(eq(goodsReceipts.id, goodsReceiptId))
    .returning();

  if (!updated) throw new Error("Goods receipt not found");
  return updated;
}
