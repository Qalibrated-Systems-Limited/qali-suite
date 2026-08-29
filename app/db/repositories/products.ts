import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { products } from "../schema";
import { isUuid, likeContains } from "./sqlHelpers";

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
  /** The snapshot of what it was filed under; `categoryId` is the real link. */
  category?: string | null;
  categoryId?: string | null;
  unit?: string;
  productType?: string;
  costPrice?: string;
  sellingPrice?: string;
  wholesalePrice?: string;
  minimumPrice?: string;
  reorderLevel?: string;
  reorderQuantity?: string;
  defaultTaxRate?: string;
  location?: string | null;
  binNumber?: string | null;
  /** Derived from the column, so a new method in the enum cannot be missed here. */
  costingMethod?: (typeof products.costingMethod)["_"]["data"];
  isActive?: boolean;
  /**
   * ONLY for a product that carries no stock. Opening stock must go through
   * `receiveOpeningStock` so it reaches the ledger — see the note there.
   */
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
      categoryId: input.categoryId ?? null,
      unit: input.unit ?? "pcs",
      productType: input.productType ?? "Inventory Item",
      costPrice: input.costPrice ?? "0",
      sellingPrice: input.sellingPrice ?? "0",
      wholesalePrice: input.wholesalePrice ?? "0",
      minimumPrice: input.minimumPrice ?? "0",
      reorderLevel: input.reorderLevel ?? "0",
      reorderQuantity: input.reorderQuantity ?? "0",
      defaultTaxRate: input.defaultTaxRate ?? "16",
      location: input.location ?? null,
      binNumber: input.binNumber ?? null,
      costingMethod: input.costingMethod ?? "average",
      isActive: input.isActive ?? true,
      quantityOnHand: input.quantityOnHand ?? "0",
      createdById: input.createdById ?? null,
    })
    .returning();

  return created;
}

export async function getProduct(tx: Tx, productId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(productId)) return null;
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
    const term = likeContains(opts.search);
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
      // No costing-method branch: 0067 narrowed the enum to the one method
      // this system performs, so a guard on `<> 'average'` is unreachable.
      costPrice: sql`CASE
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
 * Raises stock for an approved adjustment — goods found, a count that came in
 * over, a correction upward.
 *
 * NOT `receiveStock`, and the difference is not cosmetic. That function also
 * writes `last_purchase_cost` and `last_purchase_date`, because it exists for
 * goods arriving from a supplier. An adjustment is not a purchase: stock found
 * behind a shelf did not arrive today at a price anyone paid, and letting it
 * stamp the purchase provenance corrupts the one record that says what the
 * product last actually cost to buy.
 *
 * The weighted average DOES move, as it does in Mongo — `increaseInventory()`
 * calls `updateAverageCost()` (product.js:643) — because the units are real and
 * carry the cost the counter assigned them. Costing methods other than average
 * leave `cost_price` alone, as everywhere else.
 */
export async function adjustStockUp(
  tx: Tx,
  productId: string,
  quantity: string,
  unitCost: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHand: sql`${products.quantityOnHand} + ${quantity}::numeric(19,4)`,
      // No costing-method branch: 0067 narrowed the enum to the one method
      // this system performs, so a guard on `<> 'average'` is unreachable.
      costPrice: sql`CASE
        WHEN ${products.quantityOnHand} + ${quantity}::numeric(19,4) > 0
          THEN ROUND(
            (${products.quantityOnHand} * ${products.costPrice}
             + ${quantity}::numeric(19,4) * ${unitCost}::numeric(19,4))
            / (${products.quantityOnHand} + ${quantity}::numeric(19,4)), 4)
        ELSE ${products.costPrice}
      END`,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Lowers stock for an approved adjustment — damage, expiry, theft, a shortfall
 * on a count.
 *
 * NOT `issueStock`, for a reason that would be a silent oversell. That function
 * also decrements `quantity_committed`, because issuing against a sale settles
 * a commitment that was taken when the order was raised. Writing off damaged
 * goods settles nothing: the customer order those units were promised to is
 * still open. Releasing the commitment as a side effect would let the same
 * stock be committed a second time.
 *
 * There is no "is there enough?" read here, deliberately. Two CHECK constraints
 * already refuse the write — `products_quantities_non_negative` and
 * `products_commitments_within_on_hand` (0013) — and the second is the one that
 * matters: stock promised to an order cannot be written off while the promise
 * stands. Reading first would be a race; this is not.
 *
 * The cost basis is left alone. Removing units at the average does not change
 * the average.
 */
export async function adjustStockDown(
  tx: Tx,
  productId: string,
  quantity: string,
) {
  const [updated] = await tx
    .update(products)
    .set({
      quantityOnHand: sql`${products.quantityOnHand} - ${quantity}::numeric(19,4)`,
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
 * A cost of ZERO is seeded from this receipt rather than left — a product
 * created by a warehouse role starts at 0, and a zero cost basis silently
 * turns every later sale into 100% margin and every valuation into an
 * understatement.
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
      // 0067: one costing method, so the non-average branch is gone. What it
      // did — seed a ZERO cost from this receipt rather than leave it — is
      // kept below in the ELSE, because a zero cost basis silently turns every
      // later sale into 100% margin and every valuation into an
      // understatement, whatever the method.
      costPrice: sql`CASE
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
/**
 * Stock valuation — what the inventory is worth, by product and by category.
 *
 * The one inventory report, and it read a MONGO collection nothing has written
 * since products moved, so it valued an empty catalogue at nothing.
 *
 * Grouped in SQL rather than in a JS loop over every product: the report is
 * over the whole catalogue, and summing thousands of rows in the request
 * handler to produce nine numbers is work the database is better at. The
 * per-product rows come back in the same query for the expandable detail.
 *
 * TWO CORRECTIONS, both arithmetic rather than translation:
 *
 * `averageMargin` was `potentialProfit / inventoryValue * 100`, which is
 * MARKUP on cost, and the card renders it as "% margin" beside "Potential
 * profit". Margin is profit over RETAIL. On stock costing 100 and selling for
 * 150 the old figure said 50% and the true margin is 33.3%. A deliberate
 * divergence; the tests assert the corrected number.
 *
 * `category` came from a `.populate("category", "name")` on a field that
 * holds an ObjectId, while 0062 made `category` a text SNAPSHOT and
 * `category_id` the real reference. The name is read through the FK where
 * there is one and falls back to the snapshot, so a product filed before the
 * tree existed still reports what it was filed under instead of
 * "Uncategorized".
 */
export async function getStockValuation(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT p.id,
           p.name,
           p.sku                                   AS "SKU",
           p.unit,
           COALESCE(c.name, NULLIF(p.category, ''), 'Uncategorized') AS category,
           p.category_id                           AS "categoryId",
           p.quantity_on_hand::float8              AS quantity,
           p.cost_price::float8                    AS "costPrice",
           p.selling_price::float8                 AS "sellingPrice",
           (p.quantity_on_hand * p.cost_price)::float8    AS "inventoryValue",
           (p.quantity_on_hand * p.selling_price)::float8 AS "retailValue",
           (p.quantity_on_hand * (p.selling_price - p.cost_price))::float8
                                                   AS "potentialProfit"
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true
     ORDER BY p.name
  `)) as unknown as Array<{
    id: string;
    name: string;
    SKU: string;
    unit: string;
    category: string;
    categoryId: string | null;
    quantity: number;
    costPrice: number;
    sellingPrice: number;
    inventoryValue: number;
    retailValue: number;
    potentialProfit: number;
  }>;

  const products = Array.from(rows).map((r) => ({ ...r, _id: r.id }));

  const byCategory = new Map<
    string,
    {
      category: string;
      items: typeof products;
      totalQuantity: number;
      totalInventoryValue: number;
      totalRetailValue: number;
    }
  >();

  for (const product of products) {
    let group = byCategory.get(product.category);
    if (!group) {
      group = {
        category: product.category,
        items: [],
        totalQuantity: 0,
        totalInventoryValue: 0,
        totalRetailValue: 0,
      };
      byCategory.set(product.category, group);
    }
    group.items.push(product);
    group.totalQuantity += product.quantity;
    group.totalInventoryValue += product.inventoryValue;
    group.totalRetailValue += product.retailValue;
  }

  const categories = [...byCategory.values()].sort(
    (a, b) => b.totalInventoryValue - a.totalInventoryValue,
  );

  const withStock = products.filter((p) => p.quantity > 0);
  const totalInventoryValue = products.reduce((s, p) => s + p.inventoryValue, 0);
  const totalRetailValue = products.reduce((s, p) => s + p.retailValue, 0);
  const totalPotentialProfit = products.reduce((s, p) => s + p.potentialProfit, 0);

  return {
    reportName: "Stock Valuation Report",
    generatedAt: new Date(),
    products,
    categories,
    summary: {
      totalProducts: products.length,
      productsWithStock: withStock.length,
      productsOutOfStock: products.length - withStock.length,
      totalQuantity: products.reduce((s, p) => s + p.quantity, 0),
      totalInventoryValue,
      totalRetailValue,
      totalPotentialProfit,
      categoryCount: categories.length,
      // Profit over RETAIL, not over cost. See the header.
      averageMargin:
        totalRetailValue > 0 ? (totalPotentialProfit / totalRetailValue) * 100 : 0,
    },
  };
}

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

/**
 * Edits the catalogue record. NEVER the quantities.
 *
 * `quantity_on_hand`, `_committed` and `_on_hold` are moved only by the
 * functions above, each of which records a movement or is guarded by the
 * `committed + on_hold <= on_hand` CHECK. Letting an edit form write them
 * would put a number on the shelf that no movement explains, which is the
 * thing the stock ledger exists to prevent — and it is how the Mongo product
 * ended up with a stored `quantityAvailable` that disagreed with its inputs.
 *
 * Only the keys supplied are written, so a form that knows the name and
 * nothing else does not blank the description.
 */
export async function updateProduct(
  tx: Tx,
  productId: string,
  input: {
    name?: string | null;
    sku?: string | null;
    description?: string | null;
    category?: string | null;
    categoryId?: string | null;
    unit?: string | null;
    productType?: string | null;
    reorderLevel?: string | null;
    reorderQuantity?: string | null;
    defaultTaxRate?: string | null;
    location?: string | null;
    binNumber?: string | null;
    costingMethod?: (typeof products.costingMethod)["_"]["data"] | null;
    isActive?: boolean | null;
    lastModifiedById?: string | null;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name != null) set.name = input.name;
  if (input.sku != null) set.sku = input.sku.toUpperCase();
  if (input.description !== undefined) set.description = input.description;
  if (input.category !== undefined) set.category = input.category;
  if (input.categoryId !== undefined) set.categoryId = input.categoryId;
  if (input.unit != null) set.unit = input.unit;
  if (input.productType != null) set.productType = input.productType;
  if (input.reorderLevel != null) set.reorderLevel = input.reorderLevel;
  if (input.reorderQuantity != null) set.reorderQuantity = input.reorderQuantity;
  if (input.defaultTaxRate != null) set.defaultTaxRate = input.defaultTaxRate;
  if (input.location !== undefined) set.location = input.location;
  if (input.binNumber !== undefined) set.binNumber = input.binNumber;
  if (input.costingMethod != null) set.costingMethod = input.costingMethod;
  if (input.isActive != null) set.isActive = input.isActive;
  if (input.lastModifiedById !== undefined) {
    set.lastModifiedById = input.lastModifiedById;
  }

  const [updated] = await tx
    .update(products)
    .set(set)
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * Prices, separately from the rest of the record.
 *
 * Split out because the authority is split: who may set a COST is not who may
 * set a SELLING price (segregation of duties — lib/permissions.js). Keeping
 * them in `updateProduct` would mean every caller re-deriving which fields the
 * user was allowed to touch.
 *
 * Cost price is deliberately NOT here. Under weighted average it is an OUTPUT
 * of receiving stock, not an input — `receiveStock` recomputes it. Typing a
 * new cost over it would silently revalue every unit on the shelf without a
 * journal entry to explain the change; that is what an inventory revaluation
 * is for.
 */
export async function updateProductPricing(
  tx: Tx,
  productId: string,
  input: {
    sellingPrice?: string | null;
    wholesalePrice?: string | null;
    minimumPrice?: string | null;
    lastModifiedById?: string | null;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.sellingPrice != null) set.sellingPrice = input.sellingPrice;
  if (input.wholesalePrice != null) set.wholesalePrice = input.wholesalePrice;
  if (input.minimumPrice != null) set.minimumPrice = input.minimumPrice;
  if (input.lastModifiedById !== undefined) {
    set.lastModifiedById = input.lastModifiedById;
  }

  const [updated] = await tx
    .update(products)
    .set(set)
    .where(eq(products.id, productId))
    .returning();

  if (!updated) throw new Error("Product not found");
  return updated;
}

/**
 * The products list: one page, its filters, and the total in one round trip.
 *
 * `COUNT(*) OVER ()` rather than a second query, so the count cannot describe
 * a different set from the rows beside it.
 */
export async function searchProducts(
  tx: Tx,
  opts: {
    query?: string;
    category?: string;
    status?: "all" | "active" | "inactive";
    lowStockOnly?: boolean;
    page?: number;
    perPage?: number;
  } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(Math.max(1, opts.perPage ?? 25), 200);

  const where = [sql`TRUE`];
  if (opts.query) {
    const like = likeContains(opts.query);
    where.push(sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like})`);
  }
  if (opts.category && opts.category !== "all") {
    where.push(sql`p.category = ${opts.category}`);
  }
  if (opts.status === "active") where.push(sql`p.is_active = true`);
  if (opts.status === "inactive") where.push(sql`p.is_active = false`);
  // At or below the reorder level, which is what the list's "low stock" filter
  // and the dashboard's reorder alert both mean.
  if (opts.lowStockOnly) {
    where.push(sql`p.quantity_on_hand <= p.reorder_level`);
  }

  const rows = (await tx.execute(sql`
    SELECT p.*,
           COUNT(*) OVER ()::int AS total_count
      FROM products p
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY p.name
     LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
  `)) as unknown as Array<Record<string, unknown>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { rows, total, page, perPage, pages: Math.ceil(total / perPage) };
}

/**
 * The figures above the products list.
 *
 * Inventory VALUE is quantity × cost, never × selling price: stock is carried
 * at cost until it is sold. Valuing it at retail would book unrealised profit
 * onto the balance sheet.
 */
/**
 * Pricing health across the catalogue — the sales manager's two tiles.
 *
 * `avgMargin` averages the PER-PRODUCT margin, not the margin of the totals,
 * because that is what the Mongo aggregation did and the two are different
 * numbers: a catalogue of one high-volume thin-margin line and fifty fat ones
 * reads very differently each way. Kept as it was; changing it would move a
 * figure people have been reading.
 *
 * Both counts consider ACTIVE products with a cost and a price actually set.
 * A product priced at zero is not a zero-margin product, it is an unpriced
 * one, and averaging it in drags the number toward a fiction.
 */
export async function getPricingHealth(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      COALESCE(AVG(
        CASE WHEN cost_price > 0 AND selling_price > 0
             THEN (selling_price - cost_price) / selling_price * 100
        END
      ), 0)::float8 AS "avgMargin",
      count(*) FILTER (WHERE cost_price > 0 AND selling_price > 0)::int AS priced,
      -- Selling below the floor the company set for the product.
      count(*) FILTER (WHERE minimum_price > 0
                         AND selling_price < minimum_price)::int AS "belowFloor"
    FROM products
    WHERE is_active = true
  `)) as unknown as Array<{
    avgMargin: number;
    priced: number;
    belowFloor: number;
  }>;

  return row ?? { avgMargin: 0, priced: 0, belowFloor: 0 };
}

export async function getProductStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT count(*)::int                                          AS total,
           count(*) FILTER (WHERE is_active)::int                 AS active,
           count(*) FILTER (
             WHERE is_active AND quantity_on_hand <= reorder_level
           )::int                                                 AS low_stock,
           count(*) FILTER (WHERE is_active AND quantity_on_hand = 0)::int
                                                                  AS out_of_stock,
           COALESCE(SUM(quantity_on_hand * cost_price), 0)::numeric(19,4)
                                                                  AS stock_value
      FROM products
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    total: Number(row.total),
    active: Number(row.active),
    lowStock: Number(row.low_stock),
    outOfStock: Number(row.out_of_stock),
    stockValue: String(row.stock_value ?? "0"),
  };
}

/**
 * Retire a product, or delete it only if it never traded.
 *
 * A product with movements, invoice lines or commitments is HISTORY, and every
 * ERP that gets this right deactivates rather than deletes — removing it would
 * orphan the rows that explain last year's cost of sales. Mongo's delete
 * checked nothing and left exactly those dangling references.
 *
 * Returns which of the two happened so the caller can say so.
 */
export async function deleteProductOrDeactivate(tx: Tx, productId: string) {
  const [product] = await tx
    .select()
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new Error("Product not found");

  const [{ movements, lines }] = (await tx.execute(sql`
    SELECT (SELECT count(*) FROM stock_movements WHERE product_id = ${productId}::uuid)::int AS movements,
           (SELECT count(*) FROM invoice_lines  WHERE product_id = ${productId}::uuid)::int AS lines
  `)) as unknown as Array<{ movements: number; lines: number }>;

  const hasHistory =
    Number(movements) > 0 ||
    Number(lines) > 0 ||
    Number(product.quantityOnHand) !== 0 ||
    Number(product.quantityCommitted) !== 0 ||
    Number(product.quantityOnHold) !== 0;

  if (hasHistory) {
    const [deactivated] = await tx
      .update(products)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();
    return { deleted: false, deactivated: true, product: deactivated };
  }

  await tx.delete(products).where(eq(products.id, productId));
  return { deleted: true, deactivated: false, product };
}
