import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  stockAdjustments,
  stockAdjustmentLines,
  products,
} from "../schema";
import * as productsRepo from "./products";
import * as movementsRepo from "./stockMovements";
import * as accountsRepo from "./accounts";
import { createJournalEntry } from "./journal";

/**
 * Stock adjustments — the last module of substance that posted into the Mongo
 * ledger.
 *
 * WHAT THIS FILE DOES NOT CONTAIN, because 0066 says it instead: the line
 * arithmetic (generated columns), the "reason required" check, the
 * approve-only-a-draft guard (a conditional UPDATE, below), and the
 * cannot-go-negative guard (`products_quantities_non_negative`). The Mongo
 * model performed all four by hand, and `validateLines()` existed only to
 * catch a stored value disagreeing with the numbers it was derived from.
 *
 * WHAT IT DOES CONTAIN is the part SQL cannot state: the order in which a
 * movement, a stock level and a journal entry have to happen.
 */

export interface AdjustmentLineInput {
  productId: string;
  systemQuantity: string;
  physicalQuantity: string;
  unitCost: string;
  reason: string;
}

export interface CreateAdjustmentInput {
  companyId: string;
  adjustmentType: (typeof stockAdjustments.adjustmentType.enumValues)[number];
  adjustmentDate?: string;
  description?: string | null;
  notes?: string | null;
  referenceNumber?: string | null;
  lines: AdjustmentLineInput[];
  createdById?: string | null;
  createdByName: string;
}

/**
 * The three figures the Mongo document STORED, summed on read instead.
 *
 * `increase` and `decrease` are magnitudes, matching the columns they replace
 * and the `+X` / `-Y` the list renders. `net` is the one that reaches the
 * ledger.
 *
 * `total` is where the port diverges. `calculateTotals()` summed
 * `line.adjustmentValue` — which `validateLines()` defines as
 * ABS(quantity) × cost — into `totalAdjustmentValue`, so a stock take finding
 * 100,000 and writing off 100,000 stored 200,000 as its total while its effect
 * on inventory was nil, and `getAdjustmentStats()` reported that figure as the
 * value of the adjustment type. `total` here is the net. The tests assert it.
 */
function totalsSelection() {
  return {
    increase: sql<string>`COALESCE(SUM(CASE WHEN ${stockAdjustmentLines.adjustmentQuantity} > 0 THEN ${stockAdjustmentLines.adjustmentValue} ELSE 0 END), 0)::numeric(19,4)`,
    decrease: sql<string>`COALESCE(SUM(CASE WHEN ${stockAdjustmentLines.adjustmentQuantity} < 0 THEN ${stockAdjustmentLines.adjustmentValue} ELSE 0 END), 0)::numeric(19,4)`,
    net: sql<string>`COALESCE(SUM(CASE WHEN ${stockAdjustmentLines.adjustmentQuantity} > 0 THEN ${stockAdjustmentLines.adjustmentValue} ELSE -${stockAdjustmentLines.adjustmentValue} END), 0)::numeric(19,4)`,
    lineCount: sql<number>`COUNT(*)::int`,
  };
}

/** The totals for one adjustment, summed from its lines. */
export async function summariseAdjustment(tx: Tx, adjustmentId: string) {
  const [row] = await tx
    .select(totalsSelection())
    .from(stockAdjustmentLines)
    .where(eq(stockAdjustmentLines.adjustmentId, adjustmentId));

  return (
    row ?? { increase: "0", decrease: "0", net: "0", lineCount: 0 }
  );
}

/**
 * Creates a draft, snapshotting what each product was called at the time.
 *
 * `validateBeforeApproval()` cached the same three fields onto the lines at
 * APPROVE time, which meant a draft sitting for a week showed nothing until it
 * was approved and then showed today's names. Snapshotting on create is what
 * every other document on this branch does.
 */
export async function createAdjustment(tx: Tx, input: CreateAdjustmentInput) {
  if (input.lines.length === 0) {
    throw new Error("An adjustment needs at least one line.");
  }

  const [{ adjustment_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'ADJ') AS adjustment_number`,
  )) as unknown as Array<{ adjustment_number: string }>;

  const [adjustment] = await tx
    .insert(stockAdjustments)
    .values({
      companyId: input.companyId,
      adjustmentNumber: adjustment_number,
      adjustmentDate: input.adjustmentDate ?? undefined,
      adjustmentType: input.adjustmentType,
      description: input.description ?? null,
      notes: input.notes ?? null,
      referenceNumber: input.referenceNumber ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();

  for (const line of input.lines) {
    const [product] = await tx
      .select({ sku: products.sku, name: products.name, unit: products.unit })
      .from(products)
      .where(eq(products.id, line.productId));

    if (!product) {
      throw new Error(`Product not found: ${line.productId}`);
    }

    await tx.insert(stockAdjustmentLines).values({
      companyId: input.companyId,
      adjustmentId: adjustment.id,
      productId: line.productId,
      productSkuAtAdjustment: product.sku ?? "",
      productNameAtAdjustment: product.name ?? "",
      productUnitAtAdjustment: product.unit ?? "",
      systemQuantity: line.systemQuantity,
      physicalQuantity: line.physicalQuantity,
      unitCost: line.unitCost,
      reason: line.reason,
    });
  }

  return adjustment;
}

export async function getAdjustment(tx: Tx, adjustmentId: string) {
  const [adjustment] = await tx
    .select()
    .from(stockAdjustments)
    .where(eq(stockAdjustments.id, adjustmentId));

  if (!adjustment) return null;

  const lines = await tx
    .select()
    .from(stockAdjustmentLines)
    .where(eq(stockAdjustmentLines.adjustmentId, adjustmentId))
    .orderBy(stockAdjustmentLines.createdAt);

  const totals = await summariseAdjustment(tx, adjustmentId);

  return { ...adjustment, lines, ...totals };
}

export interface ListAdjustmentsFilters {
  status?: (typeof stockAdjustments.status.enumValues)[number];
  adjustmentType?: (typeof stockAdjustments.adjustmentType.enumValues)[number];
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * The list, with each row's totals summed in the same statement.
 *
 * RAW SQL, and a LEFT JOIN rather than the correlated subqueries this started
 * as. Drizzle's `.select()` did not carry the subquery columns back onto the
 * row — `lineCount` arrived undefined and the totals arrived zero, with no
 * error anywhere, so the list rendered a row with no items and no value. tsc
 * types the select's return from the keys, not from what the driver actually
 * maps, so it agreed the field was a number the whole time. The stats query
 * below was already raw for the same reason.
 */
export async function listAdjustments(
  tx: Tx,
  filters: ListAdjustmentsFilters = {},
) {
  const where = [sql`TRUE`];
  if (filters.status) where.push(sql`a.status = ${filters.status}`);
  if (filters.adjustmentType)
    where.push(sql`a.adjustment_type = ${filters.adjustmentType}`);
  if (filters.startDate)
    where.push(sql`a.adjustment_date >= ${filters.startDate}`);
  if (filters.endDate) where.push(sql`a.adjustment_date <= ${filters.endDate}`);

  const rows = (await tx.execute(sql`
    SELECT
      a.id                                AS "id",
      a.adjustment_number                 AS "adjustmentNumber",
      a.adjustment_date                   AS "adjustmentDate",
      a.adjustment_type                   AS "adjustmentType",
      a.status                            AS "status",
      a.description                       AS "description",
      a.journal_entry_id                  AS "journalEntryId",
      a.created_by_name                   AS "createdByName",
      a.created_at                        AS "createdAt",
      COALESCE(SUM(CASE WHEN l.adjustment_quantity > 0 THEN l.adjustment_value ELSE 0 END), 0)::numeric(19,4) AS "totalIncreaseValue",
      COALESCE(SUM(CASE WHEN l.adjustment_quantity < 0 THEN l.adjustment_value ELSE 0 END), 0)::numeric(19,4) AS "totalDecreaseValue",
      COUNT(l.id)::int                    AS "lineCount"
    FROM stock_adjustments a
    LEFT JOIN stock_adjustment_lines l ON l.adjustment_id = a.id
    WHERE ${sql.join(where, sql` AND `)}
    GROUP BY a.id
    ORDER BY a.adjustment_date DESC, a.created_at DESC
    LIMIT ${filters.limit ?? 50}
    OFFSET ${filters.offset ?? 0}
  `)) as unknown as Array<{
    id: string;
    adjustmentNumber: string;
    adjustmentDate: string;
    adjustmentType: string;
    status: string;
    description: string | null;
    journalEntryId: string | null;
    createdByName: string;
    createdAt: Date;
    totalIncreaseValue: string;
    totalDecreaseValue: string;
    lineCount: number;
  }>;

  return Array.from(rows);
}

/**
 * Approves a draft: the movements, the stock levels, and the entry that
 * explains them.
 *
 * THE GUARD IS THE UPDATE. `WHERE status = 'draft'` returning no row IS the
 * "can only approve draft adjustments" error, and two approvals racing cannot
 * both win it — the Mongo version read the status, then wrote, with a gap in
 * between that both callers could pass through.
 *
 * ORDER MATTERS, twice over:
 *
 *   `recordMovement` reads `quantity_on_hand` to record what the level moved
 *   FROM, so it runs BEFORE the level changes. Its own header says so, and
 *   getting it backwards records a transition that never happened.
 *
 *   The entry is posted LAST, from the lines, so a line that the database
 *   refuses — writing off stock committed to an open order — takes the whole
 *   transaction down before anything reaches the ledger.
 */
export async function approveAdjustment(
  tx: Tx,
  adjustmentId: string,
  approver: { id: string | null; name: string },
) {
  const [claimed] = await tx
    .update(stockAdjustments)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedById: approver.id,
      approvedByName: approver.name,
      lastModifiedById: approver.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockAdjustments.id, adjustmentId),
        eq(stockAdjustments.status, "draft"),
      ),
    )
    .returning();

  if (!claimed) {
    const [existing] = await tx
      .select({ status: stockAdjustments.status })
      .from(stockAdjustments)
      .where(eq(stockAdjustments.id, adjustmentId));

    throw new Error(
      existing
        ? `Can only approve draft adjustments. Current status: ${existing.status}`
        : "Adjustment not found",
    );
  }

  const lines = await tx
    .select()
    .from(stockAdjustmentLines)
    .where(eq(stockAdjustmentLines.adjustmentId, adjustmentId))
    .orderBy(stockAdjustmentLines.createdAt);

  if (lines.length === 0) {
    throw new Error("An adjustment needs at least one line.");
  }

  for (const line of lines) {
    // A line where the count agreed with the system moves nothing. Mongo
    // skipped these too, and a movement of quantity zero would fail
    // `stock_movements_quantity_positive` anyway.
    if (Number(line.adjustmentQuantity) === 0) continue;

    const increases = Number(line.adjustmentQuantity) > 0;
    const magnitude = increases
      ? line.adjustmentQuantity!
      : String(Math.abs(Number(line.adjustmentQuantity)));

    const movement = await movementsRepo.recordMovement(tx, {
      companyId: claimed.companyId,
      productId: line.productId,
      movementType: "adjustment",
      direction: increases ? "in" : "out",
      quantity: magnitude,
      unitCost: line.unitCost,
      sourceReference: `${claimed.adjustmentNumber} — ${claimed.adjustmentType}: ${line.reason}`,
      performedById: approver.id,
      performedByName: approver.name,
      affectsAccounting: true,
    });

    if (increases) {
      await productsRepo.adjustStockUp(
        tx,
        line.productId,
        magnitude,
        line.unitCost,
      );
    } else {
      await productsRepo.adjustStockDown(tx, line.productId, magnitude);
    }

    await tx
      .update(stockAdjustmentLines)
      .set({ stockMovementId: movement.id })
      .where(eq(stockAdjustmentLines.id, line.id));
  }

  const journalEntry = await postAdjustmentEntry(tx, claimed.id, approver.id);

  return { ...claimed, journalEntryId: journalEntry?.id ?? null };
}

/**
 * The entry, from the net of the lines.
 *
 * ONE PAIR OF LINES, not one per product — the Mongo shape, kept. A stock take
 * that finds some items and loses others posts the difference, because the
 * Inventory account moves by the difference. It does mean a write-off of
 * 100,000 alongside 90,000 found posts 10,000 of expense rather than both
 * gross figures, which is a real reporting limitation and not one this port
 * invented; changing it would change every adjustment already booked.
 *
 * A net of zero posts NOTHING and is not an error. The Mongo method returned
 * null and logged; `stock_adjustments_entry_only_when_approved` allows the
 * null, so the row simply carries no entry.
 */
async function postAdjustmentEntry(
  tx: Tx,
  adjustmentId: string,
  postedById: string | null,
) {
  const [adjustment] = await tx
    .select()
    .from(stockAdjustments)
    .where(eq(stockAdjustments.id, adjustmentId));

  if (adjustment.journalEntryId) {
    throw new Error("Journal entry already exists for this adjustment");
  }

  const { net } = await summariseAdjustment(tx, adjustmentId);
  if (Number(net) === 0) return null;

  const inventoryAccount = await accountsRepo.getSystemAccount(tx, "inventory");
  if (!inventoryAccount) {
    throw new Error("Inventory account not configured");
  }

  const adjustmentAccount = await accountsRepo.getSystemAccount(
    tx,
    "inventory_adjustments",
  );
  if (!adjustmentAccount) {
    throw new Error(
      "Inventory Adjustment account not configured. Please ensure chart of accounts is seeded.",
    );
  }

  const increase = Number(net) > 0;
  const value = Math.abs(Number(net)).toFixed(4);

  const entry = await createJournalEntry(tx, {
    companyId: adjustment.companyId,
    entryDate: adjustment.adjustmentDate,
    // `inventory_adjustment`, not Mongo's `adjustment`. The Postgres ledger
    // already labels stock adjustments this way — fulfilment.ts:573 — and the
    // journal browser groups on the label.
    entryType: "inventory_adjustment",
    description: `Inventory Adjustment - ${adjustment.adjustmentType} - ${adjustment.adjustmentNumber}`,
    reference: adjustment.adjustmentNumber,
    // Both halves, or `journal_entries_source_pair` refuses the insert — which
    // is how this was found. The link is bidirectional: the entry names the
    // adjustment, the adjustment names the entry.
    sourceType: "stock_adjustment",
    sourceId: adjustment.id,
    lines: increase
      ? [
          {
            accountId: inventoryAccount.id,
            debit: value,
            description: `Inventory increase - ${adjustment.adjustmentType}`,
          },
          {
            accountId: adjustmentAccount.id,
            credit: value,
            description: `Adjustment - ${adjustment.adjustmentType}`,
          },
        ]
      : [
          {
            accountId: adjustmentAccount.id,
            debit: value,
            description: `Adjustment expense - ${adjustment.adjustmentType}`,
          },
          {
            accountId: inventoryAccount.id,
            credit: value,
            description: `Inventory decrease - ${adjustment.adjustmentType}`,
          },
        ],
    createdById: postedById,
    postImmediately: true,
  });

  await tx
    .update(stockAdjustments)
    .set({ journalEntryId: entry.id, updatedAt: new Date() })
    .where(eq(stockAdjustments.id, adjustmentId));

  return entry;
}

/**
 * Cancels a draft, so a rejected approval does not leave one standing.
 *
 * THE GUARD IS THE UPDATE, as with approve: `WHERE status = 'draft'` returning
 * no row IS "can only cancel draft adjustments". An approved adjustment has
 * posted, and posting is undone by reversal, not by a status change.
 *
 * Reached from `voidApprovalTarget` in the Mongo approval engine — the only
 * caller `inventoryAdjustment.cancel()` ever had, and easy to miss because it
 * calls it on a variable named `doc`.
 */
export async function cancelAdjustment(
  tx: Tx,
  adjustmentId: string,
  canceller: { id: string | null; name: string },
  reason: string,
) {
  const [cancelled] = await tx
    .update(stockAdjustments)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: canceller.id,
      cancelledByName: canceller.name,
      cancellationReason: reason?.trim() || "No reason provided",
      lastModifiedById: canceller.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockAdjustments.id, adjustmentId),
        eq(stockAdjustments.status, "draft"),
      ),
    )
    .returning();

  if (!cancelled) {
    throw new Error("Can only cancel draft adjustments");
  }

  return cancelled;
}

/**
 * The figures on the list page's cards.
 *
 * Approved adjustments only, over a date window that defaults to the current
 * month — both as in `getAdjustmentStats()` (adjustment-queries.js:98). The
 * by-type value is the NET, which is the divergence this file's header
 * describes.
 */
export async function getAdjustmentStats(
  tx: Tx,
  range: { startDate?: string; endDate?: string } = {},
) {
  const start = range.startDate ?? sql`date_trunc('month', CURRENT_DATE)::date`;
  const end =
    range.endDate ??
    sql`(date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date`;

  // The alias, spelled out. Interpolating a Drizzle column into an aliased
  // raw query renders it as `"stock_adjustments"."status"`, which Postgres
  // rejects once the FROM clause has renamed the table to `a` — "perhaps you
  // meant to reference the table alias". tsc cannot see this; the query has to
  // be run.
  const window = sql`a.status = 'approved'
    AND a.adjustment_date >= ${start}
    AND a.adjustment_date <= ${end}`;

  const [totals] = (await tx.execute(sql`
    SELECT
      COUNT(DISTINCT a.id)::int AS "totalAdjustments",
      COUNT(l.id)::int AS "totalItems",
      COALESCE(SUM(CASE WHEN l.adjustment_quantity > 0 THEN l.adjustment_value ELSE 0 END), 0)::numeric(19,4) AS "totalIncreaseValue",
      COALESCE(SUM(CASE WHEN l.adjustment_quantity < 0 THEN l.adjustment_value ELSE 0 END), 0)::numeric(19,4) AS "totalDecreaseValue"
    FROM stock_adjustments a
    LEFT JOIN stock_adjustment_lines l ON l.adjustment_id = a.id
    WHERE ${window}
  `)) as unknown as Array<{
    totalAdjustments: number;
    totalItems: number;
    totalIncreaseValue: string;
    totalDecreaseValue: string;
  }>;

  const byType = (await tx.execute(sql`
    SELECT
      a.adjustment_type AS "_id",
      COUNT(DISTINCT a.id)::int AS count,
      COALESCE(SUM(CASE WHEN l.adjustment_quantity > 0 THEN l.adjustment_value ELSE -l.adjustment_value END), 0)::numeric(19,4) AS value
    FROM stock_adjustments a
    LEFT JOIN stock_adjustment_lines l ON l.adjustment_id = a.id
    WHERE ${window}
    GROUP BY a.adjustment_type
    ORDER BY count DESC
  `)) as unknown as Array<{ _id: string; count: number; value: string }>;

  const statuses = (await tx.execute(sql`
    SELECT status AS "_id", COUNT(*)::int AS count
    FROM stock_adjustments
    GROUP BY status
  `)) as unknown as Array<{ _id: string; count: number }>;

  return {
    totalAdjustments: totals.totalAdjustments,
    totalItems: totals.totalItems,
    totalIncreaseValue: totals.totalIncreaseValue,
    totalDecreaseValue: totals.totalDecreaseValue,
    netValue: (
      Number(totals.totalIncreaseValue) - Number(totals.totalDecreaseValue)
    ).toFixed(4),
    byType: Array.from(byType),
    byStatus: Array.from(statuses).reduce<Record<string, number>>((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {}),
  };
}

/** The dashboard strip's five most recent. */
export async function getRecentAdjustments(tx: Tx, limit = 5) {
  return listAdjustments(tx, { limit });
}
