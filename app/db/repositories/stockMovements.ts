import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { stockMovements, products } from "../schema";

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
