/**
 * Stock adjustments — 0066.
 *
 * The Mongo model (app/models/inventoryAdjustment.js, 825 lines) is replaced by
 * two tables and a repository. Most of its length was checks the schema can
 * state, and 0066's header lists which. Two things are worth repeating here
 * because they change what a caller may assume:
 *
 * 1. `adjustmentQuantity` and `adjustmentValue` are GENERATED. They are not
 *    accepted on insert, and they cannot disagree with the quantities they are
 *    derived from. `validateLines()` existed only to catch that disagreement.
 *
 * 2. There are NO stored totals. `totalIncreaseValue`, `totalDecreaseValue` and
 *    `totalAdjustmentValue` were columns on the Mongo document, written by
 *    `calculateTotals()`. They are a sum over the lines, so they are summed on
 *    read — see `summariseAdjustment` in the repository. One of the three was
 *    also wrong; 0066's header has the arithmetic.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { products } from "./products";
import { journalEntries } from "./journal";
import { stockMovements } from "./stockMovements";
import { users } from "./users";
import { adjustmentTypeEnum, adjustmentStatusEnum } from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    adjustmentNumber: text("adjustment_number").notNull(),
    adjustmentDate: date("adjustment_date").notNull().defaultNow(),
    adjustmentType: adjustmentTypeEnum("adjustment_type").notNull(),
    status: adjustmentStatusEnum("status").notNull().default("draft"),

    /**
     * Null on a draft, and null on an approved adjustment whose lines net to
     * zero — equal increases and decreases move no value, so there is nothing
     * to post. The Mongo model returned null from createJournalEntry() in that
     * case and logged it.
     */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),

    description: text("description"),
    notes: text("notes"),
    referenceNumber: text("reference_number"),

    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByName: text("approved_by_name"),

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
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_adjustments_company_number_uq").on(
      t.companyId,
      t.adjustmentNumber,
    ),
    uniqueIndex("stock_adjustments_id_company_uq").on(t.id, t.companyId),
    index("stock_adjustments_company_date_idx").on(
      t.companyId,
      t.adjustmentDate,
    ),
    index("stock_adjustments_company_status_idx").on(t.companyId, t.status),
    index("stock_adjustments_company_type_idx").on(
      t.companyId,
      t.adjustmentType,
    ),

    /**
     * Both halves of an approval or neither, written as a biconditional on the
     * STATUS rather than on the columns — the case that happens is an UPDATE
     * that flips the status and forgets the rest.
     */
    check(
      "stock_adjustments_approval_pair",
      sql`(${t.status} = 'approved') = (${t.approvedAt} IS NOT NULL AND ${t.approvedByName} IS NOT NULL)`,
    ),
    check(
      "stock_adjustments_cancellation_pair",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL AND ${t.cancelledByName} IS NOT NULL AND ${t.cancellationReason} IS NOT NULL)`,
    ),
    check(
      "stock_adjustments_entry_only_when_approved",
      sql`${t.journalEntryId} IS NULL OR ${t.status} = 'approved'`,
    ),
  ],
);

export const stockAdjustmentLines = pgTable(
  "stock_adjustment_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    adjustmentId: uuid("adjustment_id")
      .notNull()
      .references(() => stockAdjustments.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),

    productSkuAtAdjustment: text("product_sku_at_adjustment")
      .notNull()
      .default(""),
    productNameAtAdjustment: text("product_name_at_adjustment")
      .notNull()
      .default(""),
    productUnitAtAdjustment: text("product_unit_at_adjustment")
      .notNull()
      .default(""),

    systemQuantity: money("system_quantity").notNull(),
    physicalQuantity: money("physical_quantity").notNull(),
    unitCost: money("unit_cost").notNull(),

    /**
     * GENERATED. Signed — negative is a shortfall — and the only place the
     * direction of a line is stated.
     */
    adjustmentQuantity: money("adjustment_quantity").generatedAlwaysAs(
      sql`physical_quantity - system_quantity`,
    ),
    /** GENERATED, and always POSITIVE: a magnitude, as in Mongo. */
    adjustmentValue: money("adjustment_value").generatedAlwaysAs(
      sql`ABS(physical_quantity - system_quantity) * unit_cost`,
    ),

    reason: text("reason").notNull(),

    /** Set when the line is approved and its movement recorded. */
    stockMovementId: uuid("stock_movement_id").references(
      () => stockMovements.id,
      { onDelete: "restrict" },
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stock_adjustment_lines_adjustment_idx").on(t.adjustmentId),
    index("stock_adjustment_lines_company_product_idx").on(
      t.companyId,
      t.productId,
    ),

    check(
      "stock_adjustment_lines_quantities_non_negative",
      sql`${t.systemQuantity} >= 0 AND ${t.physicalQuantity} >= 0`,
    ),
    check(
      "stock_adjustment_lines_unit_cost_non_negative",
      sql`${t.unitCost} >= 0`,
    ),
    /** "Reason required for {product} adjustment" — validateLines(), line 297. */
    check(
      "stock_adjustment_lines_reason_not_blank",
      sql`length(btrim(${t.reason})) > 0`,
    ),
  ],
);
