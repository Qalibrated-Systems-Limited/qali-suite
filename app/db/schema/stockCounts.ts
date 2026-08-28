/**
 * Stocktake sessions — 0068.
 *
 * The `physical_count` adjustment type existed and the only way to use it was
 * to type the counted number straight into an adjustment form. This is
 * everything between: a sheet, a freeze, somebody counting against it, and
 * somebody else looking at the variance before it moves the books.
 *
 * TWO QUANTITIES, AND THEY ARE NOT THE SAME NUMBER.
 *
 * `systemQuantity` on a line is what the BOOK said when the sheet was
 * generated. It never changes, and it exists to answer "how far out were we" —
 * the number a stocktake is run to produce.
 *
 * It is NOT what the adjustment corrects from. Stock keeps moving while people
 * count, and a sale between the freeze and the posting is a real movement, not
 * a discrepancy; correcting from the frozen figure would silently reverse it.
 * Posting builds the adjustment from the COUNTED quantities and lets the
 * adjustment layer read the live book quantity inside its own transaction.
 * 0068's header has the longer version.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { products } from "./products";
import { categories } from "./categories";
import { stockAdjustments } from "./stockAdjustments";
import { users } from "./users";
import { stockCountStatusEnum } from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    countNumber: text("count_number").notNull(),
    countDate: date("count_date").notNull().defaultNow(),
    name: text("name").notNull(),
    notes: text("notes"),
    status: stockCountStatusEnum("status").notNull().default("draft"),

    /**
     * Null means the whole active catalogue. The SHEET is the record of what
     * was included, so a category renamed or re-parented afterwards cannot
     * change what was counted.
     */
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "restrict",
    }),

    /** The counter does not see the expected number. */
    isBlind: boolean("is_blind").notNull().default(true),

    /** When the sheet was generated and the system quantities were frozen. */
    frozenAt: timestamp("frozen_at", { withTimezone: true }),

    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedById: text("posted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    postedByName: text("posted_by_name"),

    /**
     * Null on a posted count whose lines all agreed. A stocktake that finds no
     * variance is the good outcome, not an incomplete one.
     */
    adjustmentId: uuid("adjustment_id").references(() => stockAdjustments.id, {
      onDelete: "restrict",
    }),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledByName: text("cancelled_by_name"),
    cancellationReason: text("cancellation_reason"),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_counts_company_number_uq").on(t.companyId, t.countNumber),
    uniqueIndex("stock_counts_id_company_uq").on(t.id, t.companyId),
    index("stock_counts_company_status_idx").on(t.companyId, t.status),
    index("stock_counts_company_date_idx").on(t.companyId, t.countDate),

    /** A sheet exists from `counting` onwards, and the freeze is what makes it one. */
    check(
      "stock_counts_frozen_once_open",
      sql`(${t.status} IN ('draft', 'cancelled')) OR ${t.frozenAt} IS NOT NULL`,
    ),
    check(
      "stock_counts_posting_pair",
      sql`(${t.status} = 'posted') = (${t.postedAt} IS NOT NULL AND ${t.postedByName} IS NOT NULL)`,
    ),
    check(
      "stock_counts_adjustment_only_when_posted",
      sql`${t.adjustmentId} IS NULL OR ${t.status} = 'posted'`,
    ),
    check(
      "stock_counts_cancellation_pair",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL AND ${t.cancelledByName} IS NOT NULL AND ${t.cancellationReason} IS NOT NULL)`,
    ),
    check("stock_counts_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),

    productSkuAtCount: text("product_sku_at_count").notNull().default(""),
    productNameAtCount: text("product_name_at_count").notNull().default(""),
    productUnitAtCount: text("product_unit_at_count").notNull().default(""),

    /** FROZEN when the sheet was generated. Never updated. */
    systemQuantity: money("system_quantity").notNull(),
    /**
     * Frozen too, so the value of a variance does not move because somebody
     * received stock at a different price while the count was open.
     */
    unitCost: money("unit_cost").notNull(),

    /**
     * NULL until somebody counts it — which is what makes "not yet counted"
     * distinguishable from "counted, and it agreed".
     */
    countedQuantity: money("counted_quantity"),
    countedById: text("counted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    notes: text("notes"),

    /**
     * GENERATED, and NULL while uncounted. That is the useful behaviour: a
     * variance report cannot read an uncounted line as a zero-variance one.
     *
     * Signed — negative is a shortfall.
     */
    varianceQuantity: money("variance_quantity").generatedAlwaysAs(
      sql`counted_quantity - system_quantity`,
    ),
    /** Signed as well, so a shortfall is a negative value on the report. */
    varianceValue: money("variance_value").generatedAlwaysAs(
      sql`(counted_quantity - system_quantity) * unit_cost`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * A product appears once on a sheet. Counting the same item twice on one
     * sheet is a data-entry error, not a second opinion — a recount OVERWRITES
     * the line.
     */
    uniqueIndex("stock_count_lines_count_product_uq").on(t.countId, t.productId),
    index("stock_count_lines_company_product_idx").on(t.companyId, t.productId),

    check(
      "stock_count_lines_quantities_non_negative",
      sql`${t.systemQuantity} >= 0 AND (${t.countedQuantity} IS NULL OR ${t.countedQuantity} >= 0)`,
    ),
    check("stock_count_lines_unit_cost_non_negative", sql`${t.unitCost} >= 0`),
    /** A count without a time is not a count. Both or neither. */
    check(
      "stock_count_lines_counted_pair",
      sql`(${t.countedQuantity} IS NULL) = (${t.countedAt} IS NULL)`,
    ),
  ],
);
