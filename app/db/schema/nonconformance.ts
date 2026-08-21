import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { journalEntries } from "./journal";
import { goodsReceipts, goodsReceiptLines } from "./goodsReceipts";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });
const qty = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Nonconformance reports (0051) — SOP §10.6.
 *
 * Anything received or held that does not conform: short or damaged on
 * arrival, deteriorated in storage, a tool returned broken, a count variance.
 * Nothing is released for use until its disposition has been determined AND
 * authorised, which is why the status machine below has no shortcut from
 * 'open' to 'closed'.
 *
 * THE LEDGER GAP THIS CLOSES. closeNCR moves goods out of HOLD according to
 * the disposition and posts nothing, with a comment conceding it:
 * "journal-entry posting for return/scrap is intentionally out of scope here".
 * So stock is scrapped or shipped back, physically leaves, and its value stays
 * on the balance sheet. `journalEntryId` is where the write-off lands.
 *
 * `estimated_impact` is what a person typed, and is the only figure available
 * for a count variance or a damaged tool. Where the NCR names receipt lines,
 * `nonconformance_state` derives the real value from the cost frozen on them —
 * and returns NULL rather than 0 when there is nothing to derive from, because
 * "not computable" is not "worth nothing".
 */
export const nonconformances = pgTable(
  "nonconformances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ncrNumber: text("ncr_number").notNull(),

    category: text("category").notNull(),
    /** open | disposition_proposed | authorized | closed | cancelled. */
    status: text("status").notNull().default("open"),

    sourceType: text("source_type").notNull(),
    goodsReceiptId: uuid("goods_receipt_id"),
    /**
     * Deferred references — stock counts and tool returns are not ported
     * (§10), so these carry the value without a foreign key rather than
     * dropping it. Same treatment bills gave purchase_order_id in 0015.
     */
    stockCountId: uuid("stock_count_id"),
    toolReturnId: uuid("tool_return_id"),
    sourceReference: text("source_reference"),

    supplierId: uuid("supplier_id"),
    supplierName: text("supplier_name"),

    title: text("title").notNull(),
    description: text("description").notNull(),
    photoUrls: text("photo_urls").array().notNull().default([]),

    estimatedImpact: money("estimated_impact"),

    /** pending | return_to_supplier | repair | downgrade | scrap | accept_as_is. */
    dispositionType: text("disposition_type").notNull().default("pending"),
    dispositionReason: text("disposition_reason"),
    /**
     * Three separate hands: the person who raised it cannot propose the
     * disposition, and the person who proposed it cannot authorise it. Both
     * were guards inside the actions; both are CHECK constraints now.
     */
    proposedById: text("proposed_by_id"),
    proposedByName: text("proposed_by_name"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    authorizedById: text("authorized_by_id"),
    authorizedByName: text("authorized_by_name"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    authorizationNotes: text("authorization_notes"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executedById: text("executed_by_id"),
    executedByName: text("executed_by_name"),
    executionNotes: text("execution_notes"),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    cancelledByName: text("cancelled_by_name"),
    cancellationReason: text("cancellation_reason"),

    /** Corrective Action Report — flagged here, its own entity is future work. */
    requiresCar: boolean("requires_car").notNull().default(false),
    carRaisedAt: timestamp("car_raised_at", { withTimezone: true }),
    carNotes: text("car_notes"),

    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("nonconformances_company_number_uq").on(
      t.companyId,
      t.ncrNumber,
    ),
    index("nonconformances_company_status_idx").on(
      t.companyId,
      t.status,
      t.createdAt,
    ),
    index("nonconformances_company_category_idx").on(t.companyId, t.category),
  ],
);

/**
 * NCR lines.
 *
 * `goods_receipt_line_id` names the receipt line this is about. closeNCR
 * matches them through a Map keyed on product id — the third place in this
 * module that matches documents by product, and it fails the same way: a
 * receipt with two lines of the same product, which is the ORDINARY case for a
 * nonconformance, resolves against whichever line the map happened to keep.
 *
 * `variance` is GENERATED. Mongo stores it beside the two numbers that define
 * it, which is §9.3 in miniature.
 */
export const nonconformanceLines = pgTable(
  "nonconformance_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nonconformanceId: uuid("nonconformance_id")
      .notNull()
      .references(() => nonconformances.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),

    goodsReceiptLineId: uuid("goods_receipt_line_id"),

    productId: uuid("product_id"),
    productName: text("product_name"),
    productSku: text("product_sku"),
    description: text("description"),
    unit: text("unit"),

    expectedQuantity: qty("expected_quantity").notNull().default("0"),
    actualQuantity: qty("actual_quantity").notNull().default("0"),
    /** GENERATED: actual - expected. */
    variance: qty("variance"),

    severity: text("severity").notNull().default("minor"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("nonconformance_lines_number_uq").on(
      t.nonconformanceId,
      t.lineNumber,
    ),
    index("nonconformance_lines_ncr_idx").on(t.nonconformanceId),
  ],
);
