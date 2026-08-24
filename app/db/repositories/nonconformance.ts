import { asc, eq, sql } from "drizzle-orm";
import { anyOf } from "./sqlHelpers";
import type { Tx } from "../client";
import {
  nonconformances,
  nonconformanceLines,
} from "../schema/nonconformance";
import { goodsReceiptLines } from "../schema/goodsReceipts";
import { createJournalEntry } from "./journal";
import { recordMovement } from "./stockMovements";
import {
  acceptStockFromHold,
  rejectStockFromHold,
  recostFromAcceptedReceipt,
} from "./products";

/**
 * Nonconformance (0051) — SOP §10.6.
 *
 * What was wrong with the goods, what was decided about it, and — the part
 * Mongo does not have — what that decision did to the ledger.
 *
 * closeNCR moves stock out of HOLD according to the disposition and posts
 * nothing, saying so in a comment: "journal-entry posting for return/scrap is
 * intentionally out of scope here — separate ledger work". Goods are scrapped,
 * they physically leave, and their value stays on the balance sheet. This is
 * the separate ledger work.
 */

export interface NonconformanceLineInput {
  goodsReceiptLineId?: string | null;
  productId?: string | null;
  productName?: string | null;
  productSku?: string | null;
  description?: string | null;
  unit?: string | null;
  expectedQuantity?: string;
  actualQuantity?: string;
  severity?: "minor" | "major" | "critical";
  notes?: string | null;
}

export interface CreateNonconformanceInput {
  companyId: string;
  category: string;
  sourceType:
    | "goods_receipt"
    | "stock_count"
    | "tool_return"
    | "stock_deterioration"
    | "manual";
  goodsReceiptId?: string | null;
  stockCountId?: string | null;
  toolReturnId?: string | null;
  sourceReference?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  title: string;
  description: string;
  photoUrls?: string[];
  estimatedImpact?: string | null;
  requiresCar?: boolean;
  lines?: NonconformanceLineInput[];
  createdById?: string | null;
  createdByName?: string | null;
}

const TRANSITIONS: Record<string, string[]> = {
  open: ["disposition_proposed", "cancelled"],
  // Back to 'open' revises a proposal that was not accepted.
  disposition_proposed: ["open", "authorized", "cancelled"],
  authorized: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * What a disposition does to the goods, and therefore to the books.
 *
 * The organising question is not "keep or discard" but WHO ENDS UP OWNING
 * THEM, because that is what decides whether the supplier's invoice is owed:
 *
 *   keep     accept_as_is, downgrade, repair — the goods are ours and usable.
 *            They join stock and the liability stands.
 *   write_off scrap — the goods are ours and worthless. The liability still
 *            stands; there is simply no asset at the end of it.
 *   return   return_to_supplier — never ours. Nothing is owed and nothing is
 *            posted, and the shortfall against the order stays visible in
 *            `gr_ir_open_items` rather than being written off quietly.
 *
 * 'repair' is treated as keep rather than as Mongo's no-op. There, repair
 * leaves the goods on HOLD "until the repair workflow completes" — a workflow
 * that does not exist, so the stock is held indefinitely. Closing an NCR means
 * its disposition has been CARRIED OUT (`executed_at` says so), and a repaired
 * item is a usable item. An unfinished repair is an NCR that is not closed yet.
 */
export function dispositionEffect(
  dispositionType: string,
): "keep" | "write_off" | "return" | null {
  switch (dispositionType) {
    case "accept_as_is":
    case "downgrade":
    case "repair":
      return "keep";
    case "scrap":
      return "write_off";
    case "return_to_supplier":
      return "return";
    default:
      return null;
  }
}

export async function createNonconformance(
  tx: Tx,
  input: CreateNonconformanceInput,
) {
  const [{ ncr_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'ncr')
    ) AS ncr_number`,
  )) as unknown as Array<{ ncr_number: string }>;

  const [ncr] = await tx
    .insert(nonconformances)
    .values({
      companyId: input.companyId,
      ncrNumber: ncr_number,
      category: input.category,
      sourceType: input.sourceType,
      goodsReceiptId: input.goodsReceiptId ?? null,
      stockCountId: input.stockCountId ?? null,
      toolReturnId: input.toolReturnId ?? null,
      sourceReference: input.sourceReference ?? null,
      supplierId: input.supplierId ?? null,
      supplierName: input.supplierName ?? null,
      title: input.title,
      description: input.description,
      photoUrls: input.photoUrls ?? [],
      estimatedImpact: input.estimatedImpact ?? null,
      requiresCar: input.requiresCar ?? false,
      carRaisedAt: input.requiresCar ? new Date() : null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  let n = 0;
  for (const line of input.lines ?? []) {
    n++;
    await tx.insert(nonconformanceLines).values({
      companyId: input.companyId,
      nonconformanceId: ncr.id,
      lineNumber: n,
      goodsReceiptLineId: line.goodsReceiptLineId ?? null,
      productId: line.productId ?? null,
      productName: line.productName ?? null,
      productSku: line.productSku ?? null,
      description: line.description ?? null,
      unit: line.unit ?? null,
      expectedQuantity: line.expectedQuantity ?? "0",
      actualQuantity: line.actualQuantity ?? "0",
      severity: line.severity ?? "minor",
      notes: line.notes ?? null,
    });
  }

  return ncr;
}

/**
 * Raises an NCR for the discrepant lines of a goods receipt.
 *
 * The lines it covers are named by id. Mongo's createNCRFromGRN copies the
 * product id and closeNCR later matches back through a Map keyed on it, which
 * picks the wrong line whenever a delivery carries the same product twice —
 * two pallets in different condition, which is the reason for the NCR in the
 * first place.
 */
export async function createFromGoodsReceipt(
  tx: Tx,
  goodsReceiptId: string,
  input: {
    title?: string | null;
    description?: string | null;
    createdById?: string | null;
    createdByName?: string | null;
    requiresCar?: boolean;
  } = {},
) {
  const [grn] = (await tx.execute(sql`
    SELECT g.*, s.has_discrepancy, s.has_over_receipt
      FROM goods_receipts g
      JOIN goods_receipt_state s ON s.goods_receipt_id = g.id
     WHERE g.id = ${goodsReceiptId}::uuid
  `)) as unknown as Array<Record<string, any>>;
  if (!grn) throw new Error("Goods receipt not found");

  const lines = (await tx.execute(sql`
    SELECT * FROM goods_receipt_lines
     WHERE goods_receipt_id = ${goodsReceiptId}::uuid
       AND (received_quantity <> expected_quantity
            OR packaging_condition <> 'good'
            OR physical_condition <> 'good'
            OR line_status IN ('rejected', 'hold'))
     ORDER BY line_number
  `)) as unknown as Array<Record<string, any>>;

  if (!lines.length) {
    throw new Error(
      `Goods receipt ${grn.grn_number} has nothing to raise a nonconformance about.`,
    );
  }

  const damaged = lines.some(
    (l) => l.packaging_condition !== "good" || l.physical_condition !== "good",
  );

  return createNonconformance(tx, {
    companyId: grn.company_id,
    category: damaged ? "received_damaged" : "received_qty_variance",
    sourceType: "goods_receipt",
    goodsReceiptId,
    sourceReference: grn.grn_number,
    supplierId: grn.supplier_id,
    supplierName: grn.supplier_name,
    title: input.title ?? `Discrepancy on ${grn.grn_number}`,
    description:
      input.description ??
      `Inspection of ${grn.grn_number} found ${lines.length} line(s) that do not conform. See line detail for the disposition decision.`,
    requiresCar: input.requiresCar ?? false,
    createdById: input.createdById ?? null,
    createdByName: input.createdByName ?? null,
    lines: lines.map((l) => ({
      goodsReceiptLineId: l.id,
      productId: l.product_id,
      productName: l.product_name,
      productSku: l.product_sku,
      description: l.description,
      unit: l.unit,
      expectedQuantity: l.expected_quantity,
      actualQuantity: l.received_quantity,
      severity:
        l.physical_condition === "good" && l.packaging_condition === "good"
          ? "minor"
          : "major",
      notes: l.inspection_notes,
    })),
  });
}

export async function getNonconformance(tx: Tx, nonconformanceId: string) {
  const [ncr] = await tx
    .select()
    .from(nonconformances)
    .where(eq(nonconformances.id, nonconformanceId));
  return ncr ?? null;
}

export async function getNonconformanceDetail(
  tx: Tx,
  nonconformanceId: string,
) {
  const ncr = await getNonconformance(tx, nonconformanceId);
  if (!ncr) return null;

  const lines = (await tx.execute(sql`
    SELECT ncl.*, grl.unit_cost, grl.line_status AS receipt_line_status,
           grl.received_quantity AS receipt_received_quantity
      FROM nonconformance_lines ncl
      LEFT JOIN goods_receipt_lines grl ON grl.id = ncl.goods_receipt_line_id
     WHERE ncl.nonconformance_id = ${nonconformanceId}::uuid
     ORDER BY ncl.line_number
  `)) as unknown as Array<Record<string, unknown>>;

  const [state] = (await tx.execute(sql`
    SELECT * FROM nonconformance_state WHERE nonconformance_id = ${nonconformanceId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return { ...ncr, lines, state: state ?? null };
}

/**
 * A nonconformance as the detail page renders it.
 *
 * Shaped to the page — `source.reference`, `disposition.proposedBy.at`,
 * `lines[].actualQty` — on the same precedent as orders and receipts.
 *
 * The disposition is reassembled into the nested object the markup walks. It
 * is flat in the schema because each part is a separate decision by a separate
 * person, and 0051 constrains them as such: the raiser cannot propose, the
 * proposer cannot authorise, and a closed report has both signatures and the
 * moment it was carried out.
 */
export async function getNonconformanceForDisplay(
  tx: Tx,
  nonconformanceId: string,
) {
  const detail = await getNonconformanceDetail(tx, nonconformanceId);
  if (!detail) return null;

  const state = (detail.state ?? {}) as Record<string, any>;
  const who = (id: string | null, name: string | null, at: Date | null) =>
    at ? { id, name: name ?? id, at } : null;

  return {
    _id: detail.id,
    id: detail.id,
    ncrNumber: detail.ncrNumber,
    category: detail.category,
    status: detail.status,
    title: detail.title,
    description: detail.description,
    photoUrls: detail.photoUrls,
    requiresCar: detail.requiresCar,
    carRaisedAt: detail.carRaisedAt,
    carNotes: detail.carNotes,

    source: {
      type: detail.sourceType,
      grnId: detail.goodsReceiptId,
      stockCountId: detail.stockCountId,
      toolReturnId: detail.toolReturnId,
      reference: detail.sourceReference,
    },

    supplier: detail.supplierId || detail.supplierName
      ? { partyId: detail.supplierId, name: detail.supplierName }
      : null,

    /**
     * What a person typed. `affectedValue` beside it is what the receipt lines
     * say the goods cost — null, not zero, when nothing links to one, because
     * "not computable" is not "worth nothing".
     */
    estimatedImpact:
      detail.estimatedImpact === null ? null : Number(detail.estimatedImpact),
    affectedValue:
      state.affected_value === null || state.affected_value === undefined
        ? null
        : Number(state.affected_value),
    maxSeverity: state.max_severity ?? "minor",
    awaiting: state.awaiting ?? null,

    disposition: {
      type: detail.dispositionType,
      reason: detail.dispositionReason,
      proposedBy: who(detail.proposedById, detail.proposedByName, detail.proposedAt),
      authorizedBy: detail.authorizedAt
        ? {
            id: detail.authorizedById,
            name: detail.authorizedByName ?? detail.authorizedById,
            at: detail.authorizedAt,
            notes: detail.authorizationNotes,
          }
        : null,
      executedAt: detail.executedAt,
      executedBy: detail.executedByName ? { name: detail.executedByName } : null,
      executionNotes: detail.executionNotes,
    },

    /** The write-off or debit-note entry. Mongo posts nothing at all. */
    journalEntryId: detail.journalEntryId,

    lines: (detail.lines as Array<Record<string, any>>).map((l) => ({
      _id: l.id,
      goodsReceiptLineId: l.goods_receipt_line_id,
      productId: l.product_id,
      sku: l.product_sku,
      productName: l.product_name,
      description: l.description,
      unit: l.unit,
      expectedQty: Number(l.expected_quantity),
      actualQty: Number(l.actual_quantity),
      variance: Number(l.variance ?? 0),
      severity: l.severity,
      notes: l.notes,
      unitCost: l.unit_cost === null ? null : Number(l.unit_cost),
      receiptLineStatus: l.receipt_line_status,
    })),

    cancelledAt: detail.cancelledAt,
    cancellationReason: detail.cancellationReason,
    createdAt: detail.createdAt,
    createdBy: detail.createdByName ? { name: detail.createdByName } : null,
  };
}

/** The list rows, in the shape the NCR index reads. */
export async function listNonconformancesForDisplay(
  tx: Tx,
  filters: ListNonconformancesFilters = {},
  page = 1,
  pageSize = 20,
) {
  const rows = await listNonconformances(tx, filters, page, pageSize);
  return rows.map((r: Record<string, any>) => ({
    _id: r.id,
    id: r.id,
    ncrNumber: r.ncr_number,
    category: r.category,
    status: r.status,
    title: r.title,
    source: { type: r.source_type, grnId: r.goods_receipt_id, reference: r.source_reference },
    supplier: r.supplier_name ? { partyId: r.supplier_id, name: r.supplier_name } : null,
    disposition: { type: r.disposition_type },
    maxSeverity: r.max_severity ?? "minor",
    awaiting: r.awaiting ?? null,
    affectedValue:
      r.affected_value === null || r.affected_value === undefined
        ? null
        : Number(r.affected_value),
    lineCount: r.line_count ?? 0,
    createdAt: r.created_at,
  }));
}

export interface ListNonconformancesFilters {
  status?: string | string[] | null;
  category?: string | null;
  sourceType?: string | null;
  supplierId?: string | null;
  goodsReceiptId?: string | null;
  search?: string | null;
}

function listConditions(filters: ListNonconformancesFilters) {
  const parts = [sql`TRUE`];
  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (statuses.length) parts.push(sql`n.status = ${anyOf(statuses, "text[]")}`);
  }
  if (filters.category) parts.push(sql`n.category = ${filters.category}`);
  if (filters.sourceType) parts.push(sql`n.source_type = ${filters.sourceType}`);
  if (filters.supplierId)
    parts.push(sql`n.supplier_id = ${filters.supplierId}::uuid`);
  if (filters.goodsReceiptId)
    parts.push(sql`n.goods_receipt_id = ${filters.goodsReceiptId}::uuid`);
  if (filters.search) {
    const term = `%${filters.search}%`;
    parts.push(
      sql`(n.ncr_number ILIKE ${term} OR n.title ILIKE ${term}
           OR n.description ILIKE ${term} OR n.supplier_name ILIKE ${term})`,
    );
  }
  return sql.join(parts, sql` AND `);
}

export async function listNonconformances(
  tx: Tx,
  filters: ListNonconformancesFilters = {},
  page = 1,
  pageSize = 20,
) {
  const limit = Math.min(Math.max(pageSize, 1), 200);
  const offset = Math.max(page - 1, 0) * limit;
  return (await tx.execute(sql`
    SELECT n.*, st.line_count, st.total_variance, st.affected_value,
           st.max_severity, st.awaiting
      FROM nonconformances n
      JOIN nonconformance_state st ON st.nonconformance_id = n.id
     WHERE ${listConditions(filters)}
     ORDER BY n.created_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;
}

export async function countNonconformances(
  tx: Tx,
  filters: ListNonconformancesFilters = {},
) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM nonconformances n
     WHERE ${listConditions(filters)}
  `)) as unknown as Array<{ n: number }>;
  return row?.n ?? 0;
}

export async function getNonconformanceStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                                                  AS total,
           COUNT(*) FILTER (WHERE n.status = 'open')::int                 AS open,
           COUNT(*) FILTER (WHERE n.status = 'disposition_proposed')::int AS awaiting_authorisation,
           COUNT(*) FILTER (WHERE n.status = 'authorized')::int           AS awaiting_execution,
           COUNT(*) FILTER (WHERE n.status = 'closed')::int               AS closed,
           COUNT(*) FILTER (WHERE n.requires_car)::int                    AS requiring_car,
           COUNT(*) FILTER (WHERE st.max_severity = 'critical')::int      AS critical,
           COALESCE(SUM(st.affected_value), 0)::text                      AS affected_value
      FROM nonconformances n
      JOIN nonconformance_state st ON st.nonconformance_id = n.id
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

async function setStatus(
  tx: Tx,
  nonconformanceId: string,
  to: string,
  patch: Record<string, unknown> = {},
) {
  const ncr = await getNonconformance(tx, nonconformanceId);
  if (!ncr) throw new Error("Nonconformance not found");
  if (!canTransition(ncr.status, to)) {
    throw new Error(`A ${ncr.status} nonconformance cannot become ${to}.`);
  }
  const [updated] = await tx
    .update(nonconformances)
    .set({ status: to, updatedAt: new Date(), ...patch })
    .where(eq(nonconformances.id, nonconformanceId))
    .returning();
  return updated;
}

/**
 * Somebody proposes what should happen to the goods.
 *
 * Not the person who raised the NCR — a CHECK constraint in 0051 says so, and
 * says it regardless of which caller gets here.
 */
export async function proposeDisposition(
  tx: Tx,
  nonconformanceId: string,
  dispositionType: string,
  reason: string,
  proposedById: string,
  proposedByName?: string | null,
) {
  if (!dispositionEffect(dispositionType)) {
    throw new Error(`"${dispositionType}" is not a disposition.`);
  }
  if (!reason?.trim()) {
    throw new Error("A proposed disposition needs a reason.");
  }
  return setStatus(tx, nonconformanceId, "disposition_proposed", {
    dispositionType,
    dispositionReason: reason,
    proposedById,
    proposedByName: proposedByName ?? null,
    proposedAt: new Date(),
    // A revised proposal is authorised afresh.
    authorizedById: null,
    authorizedByName: null,
    authorizedAt: null,
    authorizationNotes: null,
  });
}

/** The MD, or delegated authority, signs it off. Never the proposer. */
export async function authorizeDisposition(
  tx: Tx,
  nonconformanceId: string,
  authorizedById: string,
  authorizedByName?: string | null,
  notes?: string | null,
) {
  return setStatus(tx, nonconformanceId, "authorized", {
    authorizedById,
    authorizedByName: authorizedByName ?? null,
    authorizedAt: new Date(),
    authorizationNotes: notes ?? null,
  });
}

export interface ExecuteDispositionOptions {
  inventoryAccountId: string;
  grniAccountId: string;
  /** Where scrapped value lands. An expense; never Inventory. */
  writeOffAccountId: string;
  executedById: string;
  executedByName?: string | null;
  notes?: string | null;
}

/**
 * The disposition is carried out: the goods move, and so does the ledger.
 *
 * Each NCR line that names a receipt line is resolved according to
 * `dispositionEffect`, and which entry gets posted depends on whether those
 * goods had ever been BOUGHT:
 *
 *   line still on 'hold'   Acceptance deferred it, so no Inventory debit was
 *                          ever raised and GR/IR still carries the supplier's
 *                          side. Keeping them posts DR Inventory / CR GR/IR —
 *                          the entry acceptance would have made. Scrapping
 *                          them posts DR Write-off / CR GR/IR: still owed for,
 *                          simply worth nothing. Returning them posts nothing,
 *                          because they were never ours.
 *
 *   line already accepted  The goods are in Inventory at cost. Scrapping is
 *                          DR Write-off / CR Inventory — the ordinary write-off
 *                          — and this is the branch that covers deterioration
 *                          found in storage rather than damage on arrival.
 *
 * Whatever is left holds together: the value that leaves Inventory equals the
 * value that entered it, and every position that has not netted is visible in
 * `gr_ir_open_items` rather than resolved by silence.
 */
export async function executeDisposition(
  tx: Tx,
  nonconformanceId: string,
  opts: ExecuteDispositionOptions,
) {
  const ncr = await getNonconformance(tx, nonconformanceId);
  if (!ncr) throw new Error("Nonconformance not found");
  if (ncr.status !== "authorized") {
    throw new Error(
      `A ${ncr.status} nonconformance cannot be carried out. It must be authorised first.`,
    );
  }

  const effect = dispositionEffect(ncr.dispositionType);
  if (!effect) {
    throw new Error("This nonconformance has no disposition to carry out.");
  }

  const lines = (await tx.execute(sql`
    SELECT ncl.id, ncl.actual_quantity, ncl.goods_receipt_line_id,
           grl.id AS receipt_line_id, grl.product_id, grl.description,
           grl.unit_cost, grl.line_status, grl.received_quantity,
           grl.accepted_quantity
      FROM nonconformance_lines ncl
      JOIN goods_receipt_lines grl ON grl.id = ncl.goods_receipt_line_id
     WHERE ncl.nonconformance_id = ${nonconformanceId}::uuid
     ORDER BY ncl.line_number
  `)) as unknown as Array<Record<string, any>>;

  const jeLines: Array<{
    accountId: string;
    debit?: string;
    credit?: string;
    description?: string | null;
  }> = [];
  let grniCredit = 0;
  let inventoryCredit = 0;

  for (const line of lines) {
    const held = line.line_status === "hold";
    // A held line's quantity is everything that arrived on it; an accepted
    // line's is whatever the NCR says this is about.
    const quantity = held
      ? Number(line.received_quantity)
      : Number(line.actual_quantity);
    if (quantity <= 0) continue;

    const unitCost = Number(line.unit_cost);
    const value = Math.round(quantity * unitCost * 10000) / 10000;
    const qtyText = quantity.toFixed(4);

    if (held) {
      if (effect === "keep") {
        await acceptStockFromHold(tx, line.product_id, qtyText);
        await recostFromAcceptedReceipt(
          tx,
          line.product_id,
          qtyText,
          unitCost.toFixed(4),
        );
        if (value > 0) {
          grniCredit += value;
          jeLines.push({
            accountId: opts.inventoryAccountId,
            debit: value.toFixed(4),
            description: `Inventory admitted by ${ncr.ncrNumber} (${ncr.dispositionType}) — ${line.description}`,
          });
        }
      } else {
        // Scrapped or returned: the goods leave without ever joining stock.
        await recordMovement(tx, {
          companyId: ncr.companyId,
          productId: line.product_id,
          movementType: effect === "write_off" ? "damage" : "adjustment",
          direction: "out",
          quantity: qtyText,
          unitCost: unitCost.toFixed(4),
          sourceReference: `${ncr.ncrNumber} (${ncr.dispositionType})`,
          performedById: opts.executedById,
          performedByName: opts.executedByName ?? null,
        });
        await rejectStockFromHold(tx, line.product_id, qtyText);

        if (effect === "write_off" && value > 0) {
          // Still owed for. There is simply no asset at the end of it.
          grniCredit += value;
          jeLines.push({
            accountId: opts.writeOffAccountId,
            debit: value.toFixed(4),
            description: `Written off by ${ncr.ncrNumber} — ${line.description}`,
          });
        }
        // effect === 'return' posts nothing: never ours, never owed.
      }

      await tx
        .update(goodsReceiptLines)
        .set({
          // Scrapped goods were still BOUGHT, so the receipt line records them
          // as accepted — otherwise the order looks short by quantity the
          // supplier will invoice, and GR/IR would never net.
          acceptedQuantity: effect === "return" ? "0" : qtyText,
          lineStatus: effect === "return" ? "rejected" : "accepted",
          rejectReason:
            effect === "return"
              ? `Returned to supplier — ${ncr.ncrNumber}`
              : null,
          updatedAt: new Date(),
        })
        .where(eq(goodsReceiptLines.id, line.receipt_line_id));
      continue;
    }

    // Already in stock: an ordinary write-off against Inventory.
    if (effect === "write_off") {
      await recordMovement(tx, {
        companyId: ncr.companyId,
        productId: line.product_id,
        movementType: "damage",
        direction: "out",
        quantity: qtyText,
        unitCost: unitCost.toFixed(4),
        sourceReference: `${ncr.ncrNumber} (scrap)`,
        performedById: opts.executedById,
        performedByName: opts.executedByName ?? null,
      });
      await tx.execute(sql`
        UPDATE products
           SET quantity_on_hand = quantity_on_hand - ${qtyText}::numeric(19,4),
               updated_at = now()
         WHERE id = ${line.product_id}::uuid
      `);
      if (value > 0) {
        inventoryCredit += value;
        jeLines.push({
          accountId: opts.writeOffAccountId,
          debit: value.toFixed(4),
          description: `Written off by ${ncr.ncrNumber} — ${line.description}`,
        });
      }
    }
  }

  let entry = null;
  if (jeLines.length) {
    if (grniCredit > 0) {
      jeLines.push({
        accountId: opts.grniAccountId,
        credit: grniCredit.toFixed(4),
        description: `GR/IR cleared by ${ncr.ncrNumber}`,
      });
    }
    if (inventoryCredit > 0) {
      jeLines.push({
        accountId: opts.inventoryAccountId,
        credit: inventoryCredit.toFixed(4),
        description: `Stock removed by ${ncr.ncrNumber}`,
      });
    }

    entry = await createJournalEntry(tx, {
      companyId: ncr.companyId,
      entryDate: new Date().toISOString().slice(0, 10),
      entryType: ncr.dispositionType === "scrap" ? "write_off" : "goods_receipt",
      description: `${ncr.ncrNumber} — ${ncr.dispositionType.replace(/_/g, " ")}`,
      reference: ncr.ncrNumber,
      partyType: ncr.supplierId ? "supplier" : null,
      partyId: ncr.supplierId ?? null,
      sourceType: "nonconformance",
      sourceId: ncr.id,
      lines: jeLines,
      createdById: opts.executedById,
      postImmediately: true,
    });
  }

  return {
    nonconformance: await setStatus(tx, nonconformanceId, "closed", {
      executedAt: new Date(),
      executedById: opts.executedById,
      executedByName: opts.executedByName ?? null,
      executionNotes: opts.notes ?? null,
      journalEntryId: entry?.id ?? null,
      lastModifiedById: opts.executedById,
    }),
    entry,
  };
}

/** Raised in error, or a duplicate. Never for one already carried out. */
export async function cancelNonconformance(
  tx: Tx,
  nonconformanceId: string,
  reason: string,
  cancelledById: string,
  cancelledByName?: string | null,
) {
  if (!reason?.trim()) {
    throw new Error("Cancelling a nonconformance needs a reason.");
  }
  return setStatus(tx, nonconformanceId, "cancelled", {
    cancelledAt: new Date(),
    cancelledById,
    cancelledByName: cancelledByName ?? null,
    cancellationReason: reason,
    lastModifiedById: cancelledById,
  });
}
