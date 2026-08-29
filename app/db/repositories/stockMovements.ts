import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { stockMovements, products } from "../schema";
import { likeContains } from "./sqlHelpers";

/**
 * Stock movements — the provenance layer under COGS.
 *
 * Movements are immutable once written (migration 0014), carrying over the rule
 * the Mongo model states as "Stock movements are immutable. Create a reversal
 * instead." Only accounting links, verification and reversal state can change
 * afterwards.
 */

export interface RecordMovementInput {
  companyId: string;
  productId: string;
  movementType:
    | "issue"
    | "return"
    | "sale"
    | "purchase"
    | "adjustment"
    | "damage"
    | "transfer"
    | "initial";
  direction: "in" | "out";
  quantity: string;
  unitCost?: string;
  /** The invoice line this fulfils, when there is one. */
  invoiceLineId?: string | null;
  issuedToId?: string | null;
  sourceReference?: string | null;
  performedById?: string | null;
  performedByName?: string | null;
  requiresReturn?: boolean;
  affectsAccounting?: boolean;
  /** Set when this movement is the mirror image of another. */
  originalMovementId?: string | null;
}

/**
 * Records a movement, reading the stock level inside the same transaction so
 * previous/new cannot disagree with what the product actually held.
 *
 * The levels are checked against the quantity by a CHECK constraint: an
 * inbound movement must raise the level by exactly its quantity. Mongo records
 * all three numbers and reconciles none of them, so a movement can claim ten
 * units left while the level fell by eight.
 *
 * ORDERING: call this BEFORE moving the stock, not after.
 *
 * This function records the movement; it does not apply it. It reads
 * `quantity_on_hand` as `previous_stock` and derives `new_stock` from it, so
 * calling it after the level has already changed makes both figures describe a
 * transition that did not happen — a sale of 10 from 100 records "90 -> 80".
 * Inbound movements do not even fail loudly when this is got wrong, they just
 * record the wrong provenance, which is the whole point of the record.
 */
export async function recordMovement(tx: Tx, input: RecordMovementInput) {
  const [product] = await tx
    .select({ onHand: products.quantityOnHand, cost: products.costPrice })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw new Error("Product not found");

  const [{ movement_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'SM') AS movement_number`,
  )) as unknown as Array<{ movement_number: string }>;

  const unitCost = input.unitCost ?? product.cost;

  const [{ new_stock, total_cost }] = (await tx.execute(sql`
    SELECT
      (${product.onHand}::numeric(19,4) ${sql.raw(input.direction === "in" ? "+" : "-")} ${input.quantity}::numeric(19,4))::numeric(19,4) AS new_stock,
      (${input.quantity}::numeric(19,4) * ${unitCost}::numeric(19,4))::numeric(19,4) AS total_cost
  `)) as unknown as Array<{ new_stock: string; total_cost: string }>;

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      companyId: input.companyId,
      movementNumber: movement_number,
      productId: input.productId,
      movementType: input.movementType,
      direction: input.direction,
      quantity: input.quantity,
      previousStock: product.onHand,
      newStock: new_stock,
      unitCost,
      totalCost: total_cost,
      averageCostAtMovement: product.cost,
      invoiceLineId: input.invoiceLineId ?? null,
      issuedToId: input.issuedToId ?? null,
      sourceReference: input.sourceReference ?? null,
      performedById: input.performedById ?? null,
      performedByNameAtMovement: input.performedByName ?? null,
      requiresReturn: input.requiresReturn ?? false,
      affectsAccounting: input.affectsAccounting ?? true,
      originalMovementId: input.originalMovementId ?? null,
    })
    .returning();

  return movement;
}

/** Links a movement to the journal entries that posted it. */
export async function attachAccounting(
  tx: Tx,
  movementId: string,
  input: { journalEntryId?: string; cogsJournalEntryId?: string },
) {
  const [updated] = await tx
    .update(stockMovements)
    .set({
      journalEntryId: input.journalEntryId,
      cogsJournalEntryId: input.cogsJournalEntryId,
      updatedAt: new Date(),
    })
    .where(eq(stockMovements.id, movementId))
    .returning();

  if (!updated) throw new Error("Stock movement not found");
  return updated;
}

/**
 * Reverses a movement by writing its mirror image, then marking the original.
 * The original is never edited — that is what immutability means here.
 */
export async function reverseMovement(
  tx: Tx,
  movementId: string,
  reversedById: string,
) {
  const [original] = await tx
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.id, movementId));

  if (!original) throw new Error("Stock movement not found");
  if (original.isReversed) throw new Error("Stock movement is already reversed");

  const reversal = await recordMovement(tx, {
    companyId: original.companyId,
    productId: original.productId,
    movementType: original.movementType,
    direction: original.direction === "in" ? "out" : "in",
    quantity: original.quantity,
    unitCost: original.unitCost,
    sourceReference: `Reversal of ${original.movementNumber}`,
    performedById: reversedById,
    affectsAccounting: original.affectsAccounting,
    originalMovementId: movementId,
  });

  await tx
    .update(stockMovements)
    .set({
      isReversed: true,
      reversedAt: new Date(),
      reversedById,
      status: "reversed",
      updatedAt: new Date(),
    })
    .where(eq(stockMovements.id, movementId));

  return reversal;
}

export async function getMovement(tx: Tx, movementId: string) {
  const [movement] = await tx
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.id, movementId));
  return movement ?? null;
}

export async function listMovements(
  tx: Tx,
  opts: { productId?: string; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  return tx
    .select({
      id: stockMovements.id,
      movementNumber: stockMovements.movementNumber,
      movementDate: stockMovements.movementDate,
      movementType: stockMovements.movementType,
      direction: stockMovements.direction,
      // The snapshot, not a join — what the product was called when it moved.
      productSku: stockMovements.productSkuAtMovement,
      productName: stockMovements.productNameAtMovement,
      quantity: stockMovements.quantity,
      previousStock: stockMovements.previousStock,
      newStock: stockMovements.newStock,
      totalCost: stockMovements.totalCost,
      status: stockMovements.status,
    })
    .from(stockMovements)
    .where(
      opts.productId ? eq(stockMovements.productId, opts.productId) : undefined,
    )
    .orderBy(desc(stockMovements.movementDate))
    .limit(limit)
    .offset(opts.offset ?? 0);
}

/**
 * The full COGS provenance chain for an invoice line: what was invoiced, what
 * was costed and by whom, and what stock actually moved.
 *
 * `costed_vs_moved_variance` is the number worth watching — anything non-zero
 * means the books and the warehouse disagree about the same sale.
 */
export async function getCogsProvenance(tx: Tx, invoiceLineId: string) {
  const [row] = (await tx.execute(sql`
    SELECT * FROM cogs_provenance WHERE invoice_line_id = ${invoiceLineId}
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

/** Lines where what was costed and what moved do not agree. */
export async function getProvenanceVariances(tx: Tx, limit = 50) {
  return tx.execute(sql`
    SELECT invoice_number, line_number, product_sku, fulfilment_source,
           quantity_invoiced, quantity_costed, quantity_moved,
           costed_vs_moved_variance
      FROM cogs_provenance
     WHERE costed_vs_moved_variance <> 0
     ORDER BY ABS(costed_vs_moved_variance) DESC
     LIMIT ${Math.min(limit, 200)}
  `);
}

/**
 * The movements LEDGER SCREEN — search, filters, role scope, pagination and
 * the summary tiles above it.
 *
 * `listMovements` above is the plain read the other modules use. This is the
 * browsing surface, and it needs the shape the table renders: the product and
 * person snapshots nested as `productSnapshot` and `performedBy`, because that
 * is what `movementTable.jsx` reads.
 *
 * ROLE SCOPE IS PART OF THE QUERY, not the page. A technician sees the
 * movements they were involved in; Admin and Store Manager see everything.
 * The Mongo version checked three fields — performedBy, issuedTo, receivedBy —
 * of which `receivedBy` does not exist on the Postgres table and never did on
 * the Mongo one either: nothing wrote it. Two are checked here.
 *
 * THE SEARCH IS ILIKE ON FOUR COLUMNS, not a six-field regex OR. The Mongo
 * version needed a two-character minimum "before triggering a 6-field regex
 * OR scan (each field would otherwise do a full COLLSCAN)". The minimum is
 * kept because it is a sensible interaction, not because the query cannot
 * cope.
 */
const MOVEMENTS_PER_PAGE = 20;

export interface MovementBrowseOptions {
  search?: string | null;
  movementType?: string | null;
  direction?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  productId?: string | null;
  /** Non-null narrows to movements this person was involved in. */
  restrictToUserId?: string | null;
  page?: number;
}

function movementFilters(opts: MovementBrowseOptions) {
  const where = [sql`TRUE`];

  if (opts.restrictToUserId) {
    where.push(
      sql`(m.performed_by_id = ${opts.restrictToUserId}
           OR m.issued_to_id::text = ${opts.restrictToUserId})`,
    );
  }
  if (opts.movementType && opts.movementType !== "all") {
    where.push(sql`m.movement_type::text = ${opts.movementType}`);
  }
  if (opts.direction && opts.direction !== "all") {
    where.push(sql`m.direction::text = ${opts.direction}`);
  }
  if (opts.productId) {
    where.push(sql`m.product_id = ${opts.productId}::uuid`);
  }
  if (opts.startDate) {
    where.push(sql`m.movement_date >= ${opts.startDate}::date`);
  }
  if (opts.endDate) {
    // Inclusive of the end DAY, as the Mongo version was: it added a day and
    // used a strict less-than.
    where.push(sql`m.movement_date < (${opts.endDate}::date + 1)`);
  }

  const term = (opts.search ?? "").trim();
  if (term.length >= 2) {
    const like = likeContains(term);
    where.push(sql`(
      m.movement_number ILIKE ${like}
      OR m.product_name_at_movement ILIKE ${like}
      OR m.product_sku_at_movement ILIKE ${like}
      OR m.performed_by_name_at_movement ILIKE ${like}
      OR m.issued_to_name_at_movement ILIKE ${like}
    )`);
  }

  return sql.join(where, sql` AND `);
}

/** One page of the ledger, in the shape the table renders. */
export async function browseMovements(tx: Tx, opts: MovementBrowseOptions = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const rows = (await tx.execute(sql`
    SELECT m.id,
           m.movement_number, m.movement_type::text AS movement_type,
           m.direction::text AS direction, m.status::text AS status,
           m.quantity::float8 AS quantity,
           m.previous_stock::float8 AS previous_stock,
           m.new_stock::float8 AS new_stock,
           m.unit_cost::float8 AS unit_cost,
           m.total_cost::float8 AS total_cost,
           m.total_value::float8 AS total_value,
           m.product_id, m.product_sku_at_movement, m.product_name_at_movement,
           m.performed_by_id, m.performed_by_name_at_movement,
           m.issued_to_name_at_movement,
           m.source_reference, m.movement_date, m.created_at
      FROM stock_movements m
     WHERE ${movementFilters(opts)}
     ORDER BY m.movement_date DESC, m.created_at DESC
     LIMIT ${MOVEMENTS_PER_PAGE} OFFSET ${(page - 1) * MOVEMENTS_PER_PAGE}
  `)) as unknown as Array<Record<string, unknown>>;

  return Array.from(rows).map(shapeMovementForScreen);
}

/** How many pages the current filters cover. */
export async function countMovementPages(
  tx: Tx,
  opts: MovementBrowseOptions = {},
) {
  const [row] = (await tx.execute(sql`
    SELECT count(*)::int AS count FROM stock_movements m
     WHERE ${movementFilters(opts)}
  `)) as unknown as Array<{ count: number }>;

  return Math.max(1, Math.ceil((row?.count ?? 0) / MOVEMENTS_PER_PAGE));
}

/**
 * The tiles above the ledger.
 *
 * `total_value` falls back to `total_cost`, as the Mongo aggregation did —
 * an inbound movement carries a cost and no sale value, and the tile is about
 * value moved either way.
 */
export async function getMovementBrowseStats(
  tx: Tx,
  opts: MovementBrowseOptions = {},
) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS "totalMovements",
      count(*) FILTER (WHERE m.direction = 'in')::int  AS "totalIn",
      count(*) FILTER (WHERE m.direction = 'out')::int AS "totalOut",
      COALESCE(SUM(m.quantity) FILTER (WHERE m.direction = 'in'), 0)::float8
        AS "totalQuantityIn",
      COALESCE(SUM(m.quantity) FILTER (WHERE m.direction = 'out'), 0)::float8
        AS "totalQuantityOut",
      COALESCE(SUM(COALESCE(m.total_value, m.total_cost, 0))
               FILTER (WHERE m.direction = 'in'), 0)::float8  AS "totalValueIn",
      COALESCE(SUM(COALESCE(m.total_value, m.total_cost, 0))
               FILTER (WHERE m.direction = 'out'), 0)::float8 AS "totalValueOut"
    FROM stock_movements m
    WHERE ${movementFilters(opts)}
  `)) as unknown as Array<Record<string, number>>;

  const stats = row ?? {
    totalMovements: 0,
    totalIn: 0,
    totalOut: 0,
    totalQuantityIn: 0,
    totalQuantityOut: 0,
    totalValueIn: 0,
    totalValueOut: 0,
  };

  return {
    ...stats,
    netQuantity: stats.totalQuantityIn - stats.totalQuantityOut,
    netValue: stats.totalValueIn - stats.totalValueOut,
  };
}

/** One movement, for the detail page. */
export async function getMovementForScreen(tx: Tx, movementId: string) {
  const rows = (await tx.execute(sql`
    SELECT m.id,
           m.movement_number, m.movement_type::text AS movement_type,
           m.direction::text AS direction, m.status::text AS status,
           m.quantity::float8 AS quantity,
           m.previous_stock::float8 AS previous_stock,
           m.new_stock::float8 AS new_stock,
           m.unit_cost::float8 AS unit_cost,
           m.total_cost::float8 AS total_cost,
           m.total_value::float8 AS total_value,
           m.average_cost_at_movement::float8 AS average_cost_at_movement,
           m.product_id, m.product_sku_at_movement, m.product_name_at_movement,
           m.performed_by_id, m.performed_by_name_at_movement,
           m.issued_to_id, m.issued_to_name_at_movement,
           m.source_reference,
           m.journal_entry_id, m.cogs_journal_entry_id,
           m.is_reversed, m.reversed_at, m.original_movement_id,
           m.movement_date, m.created_at
      FROM stock_movements m
     WHERE m.id = ${movementId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.length ? shapeMovementForScreen(rows[0]) : null;
}

/**
 * The Mongo document shape the screens read: snapshots nested rather than
 * flat. Kept exactly, so `movementTable.jsx` and the detail page do not change.
 */
function shapeMovementForScreen(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    movementNumber: r.movement_number as string,
    movementType: r.movement_type as string,
    direction: r.direction as string,
    status: r.status as string,
    quantity: Number(r.quantity ?? 0),
    previousStock: Number(r.previous_stock ?? 0),
    newStock: Number(r.new_stock ?? 0),
    productId: r.product_id as string,
    productSnapshot: {
      SKU: r.product_sku_at_movement as string,
      name: r.product_name_at_movement as string,
    },
    performedBy: {
      id: r.performed_by_id as string | null,
      name: (r.performed_by_name_at_movement as string) ?? "System",
      // The Mongo snapshot carried a role and the Postgres table does not:
      // a role is not a property of a movement, it is a property of a person
      // at a point in time, and storing it made the two disagree the moment
      // somebody was promoted. The table shows the name.
      role: null,
    },
    issuedTo: r.issued_to_name_at_movement
      ? { name: r.issued_to_name_at_movement as string }
      : null,
    costing: {
      unitCost: Number(r.unit_cost ?? 0),
      totalCost: Number(r.total_cost ?? 0),
      totalValue: r.total_value == null ? null : Number(r.total_value),
      averageCostAtMovement:
        r.average_cost_at_movement == null
          ? null
          : Number(r.average_cost_at_movement),
    },
    sourceReference: (r.source_reference as string) ?? null,
    journalEntryId: (r.journal_entry_id as string) ?? null,
    cogsJournalEntryId: (r.cogs_journal_entry_id as string) ?? null,
    isReversed: Boolean(r.is_reversed),
    reversedAt: r.reversed_at ?? null,
    originalMovementId: (r.original_movement_id as string) ?? null,
    movementDate: r.movement_date,
    createdAt: r.created_at,
  };
}
