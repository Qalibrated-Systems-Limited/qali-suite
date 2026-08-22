import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { products } from "../schema";

/**
 * Product catalogue and stock commitment.
 *
 * `quantityAvailable` is never written — it is a generated column
 * (`on_hand - committed - on_hold`). The Mongo schema documents the same
 * formula and then stores the result, so it can disagree with its own inputs.
 * See docs/POSTGRES-MIGRATION-PLAN.md §8.4.
 */

export interface CreateProductInput {
  companyId: string;
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  unit?: string;
  costPrice?: string;
  sellingPrice?: string;
  quantityOnHand?: string;
  createdById?: string | null;
}

export async function createProduct(tx: Tx, input: CreateProductInput) {
  const [created] = await tx
    .insert(products)
    .values({
      companyId: input.companyId,
      sku: input.sku.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      unit: input.unit ?? "pcs",
      costPrice: input.costPrice ?? "0",
      sellingPrice: input.sellingPrice ?? "0",
      quantityOnHand: input.quantityOnHand ?? "0",
      createdById: input.createdById ?? null,
    })
    .returning();

  return created;
}

export async function getProduct(tx: Tx, productId: string) {
  const [product] = await tx
    .select()
    .from(products)
    .where(eq(products.id, productId));
  return product ?? null;
}

export async function listProducts(
  tx: Tx,
  opts: { search?: string; category?: string; activeOnly?: boolean; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conditions = [];

  if (opts.activeOnly !== false) conditions.push(eq(products.isActive, true));
  if (opts.category) conditions.push(eq(products.category, opts.category));
  if (opts.search) {
    const term = `%${opts.search}%`;
    conditions.push(or(ilike(products.name, term), ilike(products.sku, term))!);
  }

  return tx
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(products.sku))
    .limit(limit);
}

/**
 * Reserves stock for a draft invoice — the commitment step of the
 * commitment-based flow.
 *
 * The CHECK constraint `committed + on_hold <= on_hand` does the enforcing, so
 * over-committing raises rather than silently driving availability negative.
 * The read-modify-write is a single UPDATE so two concurrent commitments
 * cannot both see the same starting quantity.
 */
export async function commitStock(
  tx: Tx,
  productId: string,
  quantity: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityCommitted: sql`${products.quantityCommitted} + ${quantity}::numeric(19,4)`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/** Releases a commitment — invoice cancelled, or converted to a real issue. */
export async function releaseStock(
  tx: Tx,
  productId: string,
  quantity: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityCommitted: sql`GREATEST(0, ${products.quantityCommitted} - ${quantity}::numeric(19,4))`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Issues stock: reduces both the physical quantity and the commitment that
 * reserved it. Used when an invoice completes and goods actually leave.
 */
export async function issueStock(tx: Tx, productId: string, quantity: string) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHand: sql`${products.quantityOnHand} - ${quantity}::numeric(19,4)`,
      quantityCommitted: sql`GREATEST(0, ${products.quantityCommitted} - ${quantity}::numeric(19,4))`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Receives stock from a supplier: raises the quantity on hand and re-costs the
 * product on a weighted average.
 *
 * The average is computed in one UPDATE, in Postgres:
 *
 *     (on_hand × cost_price + received × unit_cost) / (on_hand + received)
 *
 * which is the formula `Product.updateAverageCost()` (product.js:594) applies
 * in float64 across two documents' worth of read-modify-write. Doing it in the
 * statement means two concurrent receipts cannot both re-cost from the same
 * starting quantity, and the division is exact decimal rather than binary
 * floating point — this value is the basis of every COGS figure downstream.
 *
 * Costing methods other than average leave `cost_price` alone, as in Mongo.
 */
export async function receiveStock(
  tx: Tx,
  productId: string,
  quantity: string,
  unitCost: string,
  receivedOn?: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHand: sql`${products.quantityOnHand} + ${quantity}::numeric(19,4)`,
      costPrice: sql`CASE
        WHEN ${products.costingMethod} <> 'average' THEN ${products.costPrice}
        WHEN ${products.quantityOnHand} + ${quantity}::numeric(19,4) > 0
          THEN ROUND(
            (${products.quantityOnHand} * ${products.costPrice}
             + ${quantity}::numeric(19,4) * ${unitCost}::numeric(19,4))
            / (${products.quantityOnHand} + ${quantity}::numeric(19,4)), 4)
        ELSE ${products.costPrice}
      END`,
      lastPurchaseCost: unitCost,
      lastPurchaseDate: receivedOn ?? sql`CURRENT_DATE`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Goods have physically arrived but nobody has accepted them yet (0050).
 *
 * They are on the shelf, so `quantity_on_hand` rises; they are not issuable
 * until Sales and Finance sign the receipt, so `quantity_on_hold` rises with
 * it and `quantity_available` — a GENERATED column, `on_hand - committed -
 * on_hold` — does not move at all.
 *
 * NOT re-costed here. The Inventory debit and the weighted average both belong
 * to acceptance, because goods that are ultimately rejected never had a cost
 * to average in.
 */
export async function receiveStockToHold(
  tx: Tx,
  productId: string,
  quantity: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHand: sql`${products.quantityOnHand} + ${quantity}::numeric(19,4)`,
      quantityOnHold: sql`${products.quantityOnHold} + ${quantity}::numeric(19,4)`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Accepted: the goods stay, and become issuable.
 *
 * Only the hold falls — `quantity_available` follows on its own because it is
 * generated. The Mongo equivalent decrements onHold AND increments a stored
 * quantityAvailable, which is the same movement counted twice in a value that
 * a pre-save hook also recomputes from scratch; whichever wrote last decided
 * what the number was.
 *
 * Re-costing is `receiveStock`'s job and is called alongside this one, so the
 * weighted average sees only quantity that was actually admitted.
 */
export async function acceptStockFromHold(
  tx: Tx,
  productId: string,
  quantity: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHold: sql`${products.quantityOnHold} - ${quantity}::numeric(19,4)`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Rejected: the goods leave, off the shelf and out of the hold together.
 *
 * No GREATEST(0, ...) clamp. Releasing a commitment can reasonably floor at
 * zero — a double release is a bookkeeping slip. Rejecting more than is held
 * is a claim that goods left which were never there, and the CHECK on
 * `quantity_on_hold >= 0` should refuse it rather than quietly absorb it.
 */
export async function rejectStockFromHold(
  tx: Tx,
  productId: string,
  quantity: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHand: sql`${products.quantityOnHand} - ${quantity}::numeric(19,4)`,
      quantityOnHold: sql`${products.quantityOnHold} - ${quantity}::numeric(19,4)`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Re-costs a product for goods admitted from HOLD.
 *
 * `receiveStock` cannot be used at acceptance: the quantity went on hand at
 * SUBMIT, so calling it would admit the same goods twice. This moves the
 * weighted average only.
 *
 * The denominator is `quantity_on_hand - quantity_on_hold`, and the second term
 * is the point. Goods sit on hand from the moment they are SUBMITTED, but they
 * carry no cost until they are accepted — a receipt line held for a
 * nonconformance disposition may sit there for weeks. Averaging against plain
 * `quantity_on_hand` therefore divides real value by a quantity that includes
 * uncosted units and drags the cost basis down: 20 units at 50 landing beside
 * 20 held units comes out at 25, not 50, and every COGS figure downstream
 * inherits it.
 *
 * `on_hand - on_hold` is the COSTED pool — and because the caller releases the
 * accepted units from hold before calling this, it is exactly (pre + accepted)
 * without needing to know what `pre` was. Two concurrent acceptances cannot
 * both average from the same starting quantity, either.
 *
 * `stampProductCostFromReceipt` (grn-actions.js:104) does the same arithmetic
 * in float64 across a read and a write, against `onHandAfter - acceptedQty`,
 * with no notion of the hold bucket at all.
 *
 * FIFO and specific costing keep their layer cost, but a cost of ZERO is
 * seeded from this receipt rather than left — a product created by a warehouse
 * role starts at 0, and a zero cost basis silently turns every later sale into
 * 100% margin and every valuation into an understatement.
 */
export async function recostFromAcceptedReceipt(
  tx: Tx,
  productId: string,
  acceptedQuantity: string,
  unitCost: string,
  receivedOn?: string,
) {
  if (Number(unitCost) <= 0 || Number(acceptedQuantity) <= 0) {
    return null;
  }

  const [updated] = await tx
    .update(products)
    .set({
      costPrice: sql`CASE
        WHEN ${products.costingMethod} <> 'average'
          THEN CASE WHEN ${products.costPrice} <= 0
                    THEN ${unitCost}::numeric(19,4)
                    ELSE ${products.costPrice} END
        WHEN ${products.quantityOnHand} - ${products.quantityOnHold} > 0
          THEN ROUND(
            ((${products.quantityOnHand} - ${products.quantityOnHold}
              - ${acceptedQuantity}::numeric(19,4)) * ${products.costPrice}
             + ${acceptedQuantity}::numeric(19,4) * ${unitCost}::numeric(19,4))
            / (${products.quantityOnHand} - ${products.quantityOnHold}), 4)
        ELSE ${unitCost}::numeric(19,4)
      END`,
      lastPurchaseCost: unitCost,
      lastPurchaseDate: receivedOn ?? sql`CURRENT_DATE`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/** Products at or below their reorder level. */
export async function getLowStock(tx: Tx, limit = 50) {
  return tx.execute(sql`
    SELECT id, sku, name, quantity_on_hand, quantity_available, reorder_level
      FROM products
     WHERE is_active = true
       AND reorder_level > 0
       AND quantity_available <= reorder_level
     ORDER BY (quantity_available - reorder_level) ASC
     LIMIT ${Math.min(limit, 200)}
  `);
}

/**
 * A product by SKU, or failing that by exact name.
 *
 * The weighbridge gate sends a `productCode` that may be either — Mongo's
 * lookup is `$or: [{ SKU }, { name: /^code$/i }]`, and this is that, with the
 * case-insensitive name match kept.
 */
export async function findProductByCodeOrName(tx: Tx, code: string) {
  const rows = (await tx.execute(sql`
    SELECT id, name, sku, unit, cost_price
      FROM products
     WHERE sku = ${code} OR lower(name) = lower(${code})
     ORDER BY (sku = ${code}) DESC
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    name: String(r.name),
    sku: (r.sku as string) ?? null,
    unit: (r.unit as string) ?? null,
    costPrice: String(r.cost_price ?? "0"),
  };
}
