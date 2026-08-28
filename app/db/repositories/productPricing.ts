import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { products, productPriceHistory } from "../schema";
import type { PriceField } from "../schema/productPriceHistory";

/**
 * Pricing: the decision, and the record of it.
 *
 * Both halves of what the port dropped. `updateProductPricingPg` set three
 * columns and did nothing else — no gate, no history — while the Mongo action
 * it replaced gated the change on three conditions and routed it for approval,
 * and `price_change` still sits in APPROVER_MATRIX as a type nothing raises.
 *
 * The DECISION lives here rather than in the action for the same reason the
 * adjustment routing does: a `"use server"` file cannot export a helper
 * without making it a server action, and two callers need this one — the
 * pricing dialog, and the approval engine releasing what it gated.
 */

export interface ProposedPrices {
  sellingPrice?: string | null;
  wholesalePrice?: string | null;
  minimumPrice?: string | null;
}

export interface PriceGateVerdict {
  needsApproval: boolean;
  belowCost: boolean;
  belowFloor: boolean;
  belowMarginFloor: boolean;
  /**
   * The save RAISES the floor above the price it is setting — incoherent
   * input rather than a policy breach, so it is refused rather than routed.
   * See the note in `decidePriceChange`.
   */
  floorRaisedAbovePrice: boolean;
  /** What the margin would be, for the approval's context and the message. */
  proposedMargin: number;
  cost: number;
  reason: string;
}

/**
 * Should this price change be applied, or routed?
 *
 * THREE CONDITIONS, all carried over from `stock-actions.js:985`:
 *
 *   below COST         selling under what the stock cost. A loss per unit.
 *   below the FLOOR    selling under the product's own `minimumPrice`, which
 *                      is the per-product limit somebody set deliberately.
 *   below the MARGIN   margin under the company's `minimumMarginPercent`,
 *                      which is the tenant-wide one.
 *
 * The floor is read from the PROPOSED value where the same save is changing
 * it, not from the stored one — otherwise raising the floor and dropping the
 * price in one edit would be checked against a floor that is about to be
 * replaced, and the check would pass on a number nobody is keeping.
 *
 * `canOverridePricing` (SuperAdmin, Admin, CFO) bypasses all three. It is a
 * bypass of the GATE, not of the history: an overridden change is still
 * recorded, and the record is the only thing that makes the override
 * reviewable afterwards.
 */
export async function decidePriceChange(
  tx: Tx,
  productId: string,
  proposed: ProposedPrices,
  opts: { mayOverride: boolean; minimumMarginPercent: number },
): Promise<PriceGateVerdict> {
  const [product] = await tx
    .select({
      cost: products.costPrice,
      selling: products.sellingPrice,
      minimum: products.minimumPrice,
    })
    .from(products)
    .where(eq(products.id, productId));

  if (!product) throw new Error("Product not found");

  const cost = Number(product.cost);
  const nextSelling =
    proposed.sellingPrice != null
      ? Number(proposed.sellingPrice)
      : Number(product.selling);

  const effectiveFloor =
    proposed.minimumPrice != null
      ? Number(proposed.minimumPrice)
      : Number(product.minimum);

  const belowCost = cost > 0 && nextSelling > 0 && nextSelling < cost;
  const belowFloor = effectiveFloor > 0 && nextSelling < effectiveFloor;

  // TWO READINGS OF ONE INEQUALITY, and they are different events.
  //
  // Dropping the price under a floor that ALREADY STOOD is the policy breach
  // the approval exists for — somebody wants to sell below the limit, and a
  // CFO may say yes.
  //
  // SETTING a floor above the price in the same save is not a policy breach,
  // it is a contradiction: the user is stating a limit and violating it in one
  // action, and no approver can make both true. That is refused, and it is
  // what `pg-product-actions` has always asserted.
  //
  // The two are told apart by whether the FLOOR is what moved.
  const floorIsChanging =
    proposed.minimumPrice != null &&
    Number(proposed.minimumPrice) !== Number(product.minimum);
  const floorRaisedAbovePrice =
    floorIsChanging && effectiveFloor > 0 && nextSelling > 0 && effectiveFloor > nextSelling;

  const proposedMargin =
    nextSelling > 0 ? ((nextSelling - cost) / nextSelling) * 100 : 0;
  const belowMarginFloor =
    opts.minimumMarginPercent > 0 &&
    cost > 0 &&
    nextSelling > 0 &&
    proposedMargin < opts.minimumMarginPercent;

  const reasons: string[] = [];
  if (belowCost) reasons.push("Selling price below cost");
  if (belowFloor)
    reasons.push(
      `Selling price ${nextSelling.toFixed(2)} below floor ${effectiveFloor.toFixed(2)}`,
    );
  if (belowMarginFloor)
    reasons.push(
      `Margin ${proposedMargin.toFixed(1)}% below company minimum ${opts.minimumMarginPercent}%`,
    );

  return {
    // An incoherent floor is not routed — there is nothing to approve.
    needsApproval:
      !floorRaisedAbovePrice &&
      (belowCost || belowFloor || belowMarginFloor) &&
      !opts.mayOverride,
    belowCost,
    belowFloor,
    belowMarginFloor,
    floorRaisedAbovePrice,
    proposedMargin,
    cost,
    reason: reasons.join("; "),
  };
}

export interface ApplyPricesInput {
  proposed: ProposedPrices;
  actor: { id: string | null; name: string };
  reason?: string | null;
  /** The approval requestNumber, when one released this change. */
  approvalRef?: string | null;
}

/**
 * Writes the prices and records what moved, in one transaction.
 *
 * ONE ROW PER FIELD THAT ACTUALLY CHANGED. A save that touches the selling
 * price and leaves the floor alone writes one row; a save that changes nothing
 * writes none, and the CHECK would refuse a no-op row anyway. The `before`
 * values are read inside this transaction rather than passed in, so two
 * concurrent edits cannot both record the same starting price.
 */
export async function applyPriceChange(
  tx: Tx,
  productId: string,
  input: ApplyPricesInput,
) {
  const [before] = await tx
    .select({
      companyId: products.companyId,
      cost: products.costPrice,
      selling: products.sellingPrice,
      wholesale: products.wholesalePrice,
      minimum: products.minimumPrice,
    })
    .from(products)
    .where(eq(products.id, productId));

  if (!before) throw new Error("Product not found");

  const fields: Array<{ field: PriceField; from: string; to: string | null }> = [
    { field: "selling", from: before.selling, to: input.proposed.sellingPrice ?? null },
    { field: "wholesale", from: before.wholesale, to: input.proposed.wholesalePrice ?? null },
    { field: "minimum", from: before.minimum, to: input.proposed.minimumPrice ?? null },
  ];

  const moved = fields.filter(
    (f) => f.to != null && Number(f.to) !== Number(f.from),
  );

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.proposed.sellingPrice != null)
    set.sellingPrice = input.proposed.sellingPrice;
  if (input.proposed.wholesalePrice != null)
    set.wholesalePrice = input.proposed.wholesalePrice;
  if (input.proposed.minimumPrice != null)
    set.minimumPrice = input.proposed.minimumPrice;
  set.lastModifiedById = input.actor.id;

  const [updated] = await tx
    .update(products)
    .set(set)
    .where(eq(products.id, productId))
    .returning();

  if (moved.length > 0) {
    await tx.insert(productPriceHistory).values(
      moved.map((f) => ({
        companyId: before.companyId,
        productId,
        field: f.field,
        oldValue: f.from,
        newValue: f.to as string,
        costAtChange: before.cost,
        reason: input.reason ?? null,
        approvalRef: input.approvalRef ?? null,
        changedById: input.actor.id,
        changedByName: input.actor.name,
      })),
    );
  }

  return { product: updated, changed: moved.map((f) => f.field) };
}

/**
 * The most recent price changes across the company — the sales dashboard card.
 *
 * That card has been rendering an apology since the products port, because the
 * history it read was a Mongo array nothing wrote. It reads this now.
 */
export async function listRecentPriceChanges(tx: Tx, limit = 8) {
  const rows = (await tx.execute(sql`
    SELECT h.id,
           h.field,
           h.old_value::float8      AS "oldValue",
           h.new_value::float8      AS "newValue",
           h.cost_at_change::float8 AS "costAtChange",
           h.reason,
           h.approval_ref           AS "approvalRef",
           h.changed_by_name        AS "changedByName",
           h.changed_at             AS "changedAt",
           p.sku                    AS "SKU",
           p.name                   AS "productName",
           p.id                     AS "productId"
      FROM product_price_history h
      JOIN products p ON p.id = h.product_id
     ORDER BY h.changed_at DESC
     LIMIT ${Math.min(limit, 100)}
  `)) as unknown as Array<Record<string, unknown>>;

  return Array.from(rows);
}

/** One product's price history, newest first — the product detail page. */
export async function listPriceHistoryFor(
  tx: Tx,
  productId: string,
  limit = 50,
) {
  return tx
    .select()
    .from(productPriceHistory)
    .where(
      and(
        eq(productPriceHistory.productId, productId),
        sql`TRUE`,
      ),
    )
    .orderBy(desc(productPriceHistory.changedAt))
    .limit(Math.min(limit, 200));
}
