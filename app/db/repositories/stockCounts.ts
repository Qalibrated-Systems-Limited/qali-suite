import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { stockCounts, stockCountLines, products } from "../schema";

/**
 * Stocktake sessions — the part that is not a constraint.
 *
 * 0068 states the shape: the pair CHECKs, the generated variances, the
 * one-line-per-product index. What is here is the ORDER of a stocktake, which
 * SQL cannot state:
 *
 *   generate the sheet, freezing what the book says
 *   count against it, as many times as it takes
 *   review the variances
 *   post: one adjustment, built from the counted quantities
 *
 * THE POSTING IS THE SUBTLE PART. It builds the adjustment from what was
 * COUNTED and lets the adjustment layer read the live book quantity in its own
 * transaction — it does not correct from the frozen figure. Stock keeps moving
 * while people count; a sale between the freeze and the posting is a real
 * movement, and correcting from the frozen number would silently reverse it.
 * The frozen number answers "how far out were we", which is a different
 * question and the one a stocktake is run to ask.
 */

export interface CreateCountInput {
  companyId: string;
  name: string;
  countDate?: string;
  notes?: string | null;
  categoryId?: string | null;
  isBlind?: boolean;
  createdById?: string | null;
  createdByName: string;
}

/** A sheet nobody has generated yet. */
export async function createCount(tx: Tx, input: CreateCountInput) {
  const [{ count_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'SCT') AS count_number`,
  )) as unknown as Array<{ count_number: string }>;

  const [count] = await tx
    .insert(stockCounts)
    .values({
      companyId: input.companyId,
      countNumber: count_number,
      countDate: input.countDate ?? undefined,
      name: input.name,
      notes: input.notes ?? null,
      categoryId: input.categoryId ?? null,
      isBlind: input.isBlind ?? true,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();

  return count;
}

/**
 * Generates the sheet and freezes the book against it.
 *
 * ONE STATEMENT, INSERT ... SELECT, for a reason: a sheet built by reading the
 * catalogue into the application and writing rows back would freeze each
 * product at a slightly different instant, and on a large catalogue that
 * window is long enough for stock to move through it. Here every line's
 * `system_quantity` is read at the same point in the same transaction.
 *
 * THE GUARD IS THE UPDATE. `WHERE status = 'draft'` returning no row IS "this
 * sheet has already been generated", and two people pressing the button
 * together cannot both win it.
 *
 * Inactive products are excluded, and so are products the category filter does
 * not cover. Counting what you do not stock produces variance lines nobody
 * asked for.
 */
export async function freezeSheet(tx: Tx, countId: string) {
  const [claimed] = await tx
    .update(stockCounts)
    .set({ status: "counting", frozenAt: new Date(), updatedAt: new Date() })
    .where(and(eq(stockCounts.id, countId), eq(stockCounts.status, "draft")))
    .returning();

  if (!claimed) {
    const [existing] = await tx
      .select({ status: stockCounts.status })
      .from(stockCounts)
      .where(eq(stockCounts.id, countId));

    throw new Error(
      existing
        ? `The sheet for this count has already been generated (status: ${existing.status}).`
        : "Stock count not found",
    );
  }

  const inserted = (await tx.execute(sql`
    INSERT INTO stock_count_lines
      (company_id, count_id, product_id, product_sku_at_count,
       product_name_at_count, product_unit_at_count, system_quantity, unit_cost)
    SELECT ${claimed.companyId}::uuid, ${countId}::uuid, p.id,
           COALESCE(p.sku, ''), COALESCE(p.name, ''), COALESCE(p.unit, ''),
           p.quantity_on_hand, p.cost_price
      FROM products p
     WHERE p.is_active = true
       ${
         claimed.categoryId
           ? sql`AND p.category_id = ${claimed.categoryId}::uuid`
           : sql``
       }
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  const lineCount = Array.from(inserted).length;
  if (lineCount === 0) {
    throw new Error(
      "There are no active products in this count's scope, so there is nothing to count.",
    );
  }

  return { ...claimed, lineCount };
}

/**
 * Records a count against one line.
 *
 * A RECOUNT OVERWRITES, deliberately. The unique index says a product appears
 * once on a sheet; counting it again is a correction of the first count, not a
 * second opinion to be averaged or appended. What the first count said is not
 * kept — if that history is ever wanted it belongs in an audit table, not in
 * duplicate lines that every variance sum would then double.
 *
 * Only while the count is open: a posted sheet is a record of what was found.
 */
export async function recordCount(
  tx: Tx,
  countId: string,
  lineId: string,
  input: { quantity: string; countedById: string | null; notes?: string | null },
) {
  const [count] = await tx
    .select({ status: stockCounts.status })
    .from(stockCounts)
    .where(eq(stockCounts.id, countId));

  if (!count) throw new Error("Stock count not found");
  if (count.status !== "counting" && count.status !== "review") {
    throw new Error(
      `Counts can only be entered while the sheet is open. Current status: ${count.status}`,
    );
  }

  const [line] = await tx
    .update(stockCountLines)
    .set({
      countedQuantity: input.quantity,
      countedById: input.countedById,
      countedAt: new Date(),
      notes: input.notes ?? null,
    })
    .where(
      and(
        eq(stockCountLines.id, lineId),
        eq(stockCountLines.countId, countId),
      ),
    )
    .returning();

  if (!line) throw new Error("That line is not on this count sheet");
  return line;
}

/** Progress and variance, summed from the lines. */
export async function summariseCount(tx: Tx, countId: string) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int                                          AS "lineCount",
      count(counted_quantity)::int                           AS "countedLines",
      count(*) FILTER (WHERE variance_quantity <> 0)::int     AS "varianceLines",
      count(*) FILTER (WHERE variance_quantity > 0)::int      AS "overLines",
      count(*) FILTER (WHERE variance_quantity < 0)::int      AS "shortLines",
      COALESCE(SUM(variance_value) FILTER (WHERE variance_value > 0), 0)::numeric(19,4)
                                                             AS "overValue",
      COALESCE(SUM(-variance_value) FILTER (WHERE variance_value < 0), 0)::numeric(19,4)
                                                             AS "shortValue",
      COALESCE(SUM(variance_value), 0)::numeric(19,4)         AS "netVarianceValue",
      -- What the sheet was worth when it was frozen, so the variance can be
      -- read as a proportion of the stock actually counted.
      COALESCE(SUM(system_quantity * unit_cost), 0)::numeric(19,4)
                                                             AS "frozenValue"
    FROM stock_count_lines
    WHERE count_id = ${countId}::uuid
  `)) as unknown as Array<Record<string, string | number>>;

  return (
    row ?? {
      lineCount: 0,
      countedLines: 0,
      varianceLines: 0,
      overLines: 0,
      shortLines: 0,
      overValue: "0",
      shortValue: "0",
      netVarianceValue: "0",
      frozenValue: "0",
    }
  );
}

/** Moves a fully counted sheet to review. */
export async function submitForReview(tx: Tx, countId: string) {
  const summary = await summariseCount(tx, countId);
  if (Number(summary.countedLines) < Number(summary.lineCount)) {
    const missing =
      Number(summary.lineCount) - Number(summary.countedLines);
    throw new Error(
      `${missing} line${missing === 1 ? "" : "s"} on this sheet ${missing === 1 ? "has" : "have"} not been counted yet.`,
    );
  }

  const [moved] = await tx
    .update(stockCounts)
    .set({ status: "review", updatedAt: new Date() })
    .where(and(eq(stockCounts.id, countId), eq(stockCounts.status, "counting")))
    .returning();

  if (!moved) throw new Error("Only a sheet being counted can be submitted.");
  return moved;
}

/**
 * The lines a posting would move — every counted line that disagrees.
 *
 * Shaped as the adjustment layer's line input, because that is the only thing
 * this is for. `unitCost` is NOT sent: the adjustment reads the product's own
 * cost, and a count that has been open for a week should not price today's
 * correction at last week's cost basis. The frozen cost stays on the count
 * line, where it prices the VARIANCE REPORT.
 */
export async function varianceLinesFor(tx: Tx, countId: string) {
  const rows = (await tx.execute(sql`
    SELECT l.product_id            AS "productId",
           l.product_name_at_count AS "productName",
           l.system_quantity::text AS "systemQuantity",
           l.counted_quantity::text AS "countedQuantity",
           l.variance_quantity::text AS "varianceQuantity",
           l.notes
      FROM stock_count_lines l
     WHERE l.count_id = ${countId}::uuid
       AND l.counted_quantity IS NOT NULL
       AND l.variance_quantity <> 0
     ORDER BY l.product_name_at_count
  `)) as unknown as Array<{
    productId: string;
    productName: string;
    systemQuantity: string;
    countedQuantity: string;
    varianceQuantity: string;
    notes: string | null;
  }>;

  return Array.from(rows);
}

/**
 * Marks the sheet posted and links the adjustment it raised.
 *
 * The adjustment itself is built in the ACTION layer, which is where the
 * adjustment module's own action lives — going through it rather than around
 * it means the stocktake inherits the segregation of duties, the zero-cost
 * guard and the routing rules rather than reimplementing them.
 *
 * `adjustmentId` may be null: a sheet where every line agreed posts nothing,
 * and that is the good outcome.
 */
export async function markPosted(
  tx: Tx,
  countId: string,
  poster: { id: string | null; name: string },
  adjustmentId: string | null,
) {
  const [posted] = await tx
    .update(stockCounts)
    .set({
      status: "posted",
      postedAt: new Date(),
      postedById: poster.id,
      postedByName: poster.name,
      adjustmentId,
      updatedAt: new Date(),
    })
    .where(and(eq(stockCounts.id, countId), eq(stockCounts.status, "review")))
    .returning();

  if (!posted) {
    throw new Error("Only a sheet that has been reviewed can be posted.");
  }
  return posted;
}

/** Abandons a sheet that has not been posted. */
export async function cancelCount(
  tx: Tx,
  countId: string,
  canceller: { id: string | null; name: string },
  reason: string,
) {
  const [cancelled] = await tx
    .update(stockCounts)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: canceller.id,
      cancelledByName: canceller.name,
      cancellationReason: reason?.trim() || "No reason given",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockCounts.id, countId),
        sql`${stockCounts.status} IN ('draft', 'counting', 'review')`,
      ),
    )
    .returning();

  if (!cancelled) {
    throw new Error("A posted count cannot be cancelled.");
  }
  return cancelled;
}

/** One count, its lines and its totals. */
export async function getCount(tx: Tx, countId: string) {
  const [count] = await tx
    .select()
    .from(stockCounts)
    .where(eq(stockCounts.id, countId));

  if (!count) return null;

  const lines = await tx
    .select()
    .from(stockCountLines)
    .where(eq(stockCountLines.countId, countId))
    .orderBy(stockCountLines.productNameAtCount);

  const summary = await summariseCount(tx, countId);

  return { ...count, lines, ...summary };
}

/** Just the lines that disagree — what the review screen opens on. */
export async function getVariances(tx: Tx, countId: string) {
  return tx
    .select()
    .from(stockCountLines)
    .where(
      and(
        eq(stockCountLines.countId, countId),
        isNotNull(stockCountLines.countedQuantity),
        sql`${stockCountLines.varianceQuantity} <> 0`,
      ),
    )
    .orderBy(sql`abs(${stockCountLines.varianceValue}) DESC`);
}

export async function listCounts(
  tx: Tx,
  opts: { status?: (typeof stockCounts.status.enumValues)[number]; limit?: number } = {},
) {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.count_number AS "countNumber", c.count_date AS "countDate",
           c.name, c.status::text AS status, c.is_blind AS "isBlind",
           c.created_by_name AS "createdByName", c.created_at AS "createdAt",
           c.adjustment_id AS "adjustmentId",
           (SELECT count(*)::int FROM stock_count_lines l
             WHERE l.count_id = c.id)                              AS "lineCount",
           (SELECT count(counted_quantity)::int FROM stock_count_lines l
             WHERE l.count_id = c.id)                              AS "countedLines",
           (SELECT count(*)::int FROM stock_count_lines l
             WHERE l.count_id = c.id AND l.variance_quantity <> 0) AS "varianceLines"
      FROM stock_counts c
     ${opts.status ? sql`WHERE c.status = ${opts.status}` : sql``}
     ORDER BY c.count_date DESC, c.created_at DESC
     LIMIT ${Math.min(opts.limit ?? 50, 200)}
  `)) as unknown as Array<Record<string, unknown>>;

  return Array.from(rows);
}
