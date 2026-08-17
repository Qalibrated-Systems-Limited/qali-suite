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
