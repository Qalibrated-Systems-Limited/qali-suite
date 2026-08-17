import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  date,
  boolean,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { products } from "./products";
import { parties } from "./parties";
import { journalEntries } from "./journal";
import { invoiceLines } from "./invoices";
import {
  movementTypeEnum,
  movementDirectionEnum,
  movementStatusEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

const qty = (name: string) => numeric(name, { precision: 19, scale: 4 });

/**
 * Every physical movement of stock — the provenance layer under COGS.
 *
 * `cogs_postings` already records what a sale cost and who costed it. This
 * records the stock that actually moved, completing the chain:
 *
 *     invoice line -> COGS posting -> stock movement
 *
 * IMMUTABLE BY DESIGN, and that comes straight from the Mongo model rather than
 * being invented here. Its pre-save hook rejects any change outside a short
 * allow-list with "Stock movements are immutable. Create a reversal instead."
 * That is the right rule — a movement records a physical event that either
 * happened or did not — so it is kept and enforced by a trigger (migration
 * 0014) instead of a hook that only fires on document.save().
 *
 * Mutable after creation: accounting links, verification, status, reversal.
 * Everything else — product, quantity, direction, costing, stock levels — is
 * what happened, and cannot be edited.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    movementNumber: text("movement_number").notNull(),
    productId: uuid("product_id").notNull(),

    /** What the product was called when it moved. Immutable snapshot (§9.4). */
    productSkuAtMovement: text("product_sku_at_movement").notNull().default(""),
    productNameAtMovement: text("product_name_at_movement").notNull().default(""),

    movementType: movementTypeEnum("movement_type").notNull(),
    direction: movementDirectionEnum("direction").notNull(),

    quantity: qty("quantity").notNull(),
    /**
     * Stock level either side of this movement. Recorded, not derived: it is
     * evidence of what the books said at the time, and re-deriving it from a
     * later sum would hide any discrepancy rather than reveal it.
     */
    previousStock: qty("previous_stock").notNull(),
    newStock: qty("new_stock").notNull(),

    // ── Costing, frozen at the moment of movement ──────────────────────────
    unitCost: money("unit_cost").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    unitPrice: money("unit_price"),
    totalValue: money("total_value"),
    /** The running average cost when this movement happened. */
    averageCostAtMovement: money("average_cost_at_movement"),

    // ── Accounting links (mutable: posted after the fact) ──────────────────
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    cogsJournalEntryId: uuid("cogs_journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    affectsAccounting: boolean("affects_accounting").notNull().default(true),

    // ── Provenance: what caused this movement ──────────────────────────────
    /**
     * The invoice line this movement fulfils, when there is one. This is the
     * link that lets a COGS figure be traced to the stock that actually left.
     */
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id, {
      onDelete: "restrict",
    }),
    sourceReference: text("source_reference"),

    // ── People ─────────────────────────────────────────────────────────────
    performedById: uuid("performed_by_id"),
    performedByNameAtMovement: text("performed_by_name_at_movement"),
    issuedToId: uuid("issued_to_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    issuedToNameAtMovement: text("issued_to_name_at_movement"),

    requiresReturn: boolean("requires_return").notNull().default(false),
    expectedReturnDate: date("expected_return_date"),
    actualReturnDate: date("actual_return_date"),

    verifiedById: uuid("verified_by_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    // ── Reversal ───────────────────────────────────────────────────────────
    status: movementStatusEnum("status").notNull().default("completed"),
    isReversed: boolean("is_reversed").notNull().default(false),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedById: uuid("reversed_by_id"),
    originalMovementId: uuid("original_movement_id").references(
      (): AnyPgColumn => stockMovements.id,
      { onDelete: "restrict" },
    ),

    movementDate: timestamp("movement_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_movements_company_number_uq").on(
      t.companyId,
      t.movementNumber,
    ),
    uniqueIndex("stock_movements_id_company_uq").on(t.id, t.companyId),
    index("stock_movements_company_product_idx").on(t.companyId, t.productId),
    index("stock_movements_company_date_idx").on(
      t.companyId,
      t.movementDate.desc(),
    ),
    index("stock_movements_company_type_idx").on(t.companyId, t.movementType),
    // Provenance lookup: which movement fulfilled this invoice line.
    index("stock_movements_invoice_line_idx")
      .on(t.invoiceLineId)
      .where(sql`${t.invoiceLineId} IS NOT NULL`),
    check("stock_movements_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "stock_movements_costs_non_negative",
      sql`${t.unitCost} >= 0 AND ${t.totalCost} >= 0`,
    ),
    check(
      "stock_movements_levels_non_negative",
      sql`${t.previousStock} >= 0 AND ${t.newStock} >= 0`,
    ),
    /**
     * The arithmetic of the movement must hold: an inbound movement raises the
     * level by the quantity, an outbound lowers it. Mongo records all three
     * numbers and checks none of them against each other, so a movement can
     * claim 10 units left while the level fell by 8.
     */
    check(
      "stock_movements_levels_consistent",
      sql`(${t.direction} = 'in'  AND ${t.newStock} = ${t.previousStock} + ${t.quantity})
       OR (${t.direction} = 'out' AND ${t.newStock} = ${t.previousStock} - ${t.quantity})`,
    ),
  ],
);
