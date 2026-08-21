import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });
const percent = (name: string) =>
  numeric(name, { precision: 9, scale: 4, mode: "string" });
const qty = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Purchase orders (0049).
 *
 * What the supplier was asked to deliver. A planning document: it posts
 * nothing, and the ledger only hears about it when goods arrive (0050) or a
 * bill is approved (0015).
 *
 * TWO THINGS ARE NOT HERE, deliberately.
 *
 * `received_quantity` is not a column. Mongo keeps one per line and increments
 * it from two places that do not know about each other — convertToBill() and
 * acceptGRN() — so goods billed and received against the same order are
 * counted twice, and the order then refuses to bill quantity nobody billed.
 * How much ARRIVED and how much was INVOICED are different facts, which is
 * exactly what GR/IR exists to hold apart. `purchase_order_line_received`
 * (0050) and `purchase_order_line_billed` (0049) derive each from the
 * documents that justify it.
 *
 * 'expired', 'partial' and 'received' are not statuses. The first was written
 * by a pre-save hook that re-expired the order on ANY save — reopen() has to
 * push validUntil forward to escape its own hook — and the other two were
 * computed from the counter above. `status` holds only what a person chose;
 * `purchase_order_state` (0050) derives the rest.
 *
 * The totals are here so queries can select them, NOT for writing:
 * recalc_purchase_order() owns subtotal, vat_total and total, and wht_amount
 * and net_payable are generated from them.
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    poNumber: text("po_number").notNull(),

    supplierId: uuid("supplier_id").notNull(),
    /** What the supplier was called on the order we sent them (§9.4). */
    supplierName: text("supplier_name").notNull(),
    supplierTaxPin: text("supplier_tax_pin"),
    supplierEmail: text("supplier_email"),
    supplierPhone: text("supplier_phone"),
    supplierAddress: text("supplier_address"),

    poDate: date("po_date").notNull(),
    expectedDeliveryDate: date("expected_delivery_date"),
    validUntil: date("valid_until"),

    /** draft | sent | confirmed | cancelled | closed — and nothing derived. */
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("KES"),

    whtApplicable: boolean("wht_applicable").notNull().default(false),
    whtRate: percent("wht_rate").notNull().default("0"),

    /**
     * How much over the ordered quantity this order will accept, as a
     * percentage. 0 — the default — means exactly what was ordered and not one
     * unit more. A trigger in 0050 enforces it cumulatively across every live
     * receipt, so accepting an over-delivery is a decision the buyer makes on
     * the order in advance rather than something the dock discovers.
     */
    receiptTolerancePercentage: percent("receipt_tolerance_percentage")
      .notNull()
      .default("0"),

    /** Derived by trigger. Read these; never write them. */
    subtotal: money("subtotal").notNull().default("0"),
    vatTotal: money("vat_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    /** GENERATED from subtotal and the rate. Not writable at all. */
    whtAmount: money("wht_amount"),
    netPayable: money("net_payable"),

    deliveryAddress: text("delivery_address"),
    deliveryInstructions: text("delivery_instructions"),
    notes: text("notes"),
    termsAndConditions: text("terms_and_conditions"),
    internalNotes: text("internal_notes"),

    // Lifecycle stamps. What happened to the outbound EMAIL is in
    // document_deliveries (0041), which already accepts 'purchase_order' —
    // the four columns Mongo kept on the order could not answer "what
    // happened on the second attempt".
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentById: text("sent_by_id"),
    sentByName: text("sent_by_name"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedById: text("confirmed_by_id"),
    confirmedByName: text("confirmed_by_name"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    cancelledByName: text("cancelled_by_name"),
    cancellationReason: text("cancellation_reason"),
    /** Closed short — somebody decided no more will arrive against this. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedById: text("closed_by_id"),
    closedByName: text("closed_by_name"),
    closureReason: text("closure_reason"),

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
    uniqueIndex("purchase_orders_company_number_uq").on(t.companyId, t.poNumber),
    index("purchase_orders_company_status_idx").on(t.companyId, t.status),
    index("purchase_orders_company_date_idx").on(t.companyId, t.poDate),
    index("purchase_orders_supplier_idx").on(
      t.companyId,
      t.supplierId,
      t.status,
    ),
  ],
);

/**
 * Order lines.
 *
 * Frozen once the order leaves draft — a trigger, not a `canEdit` virtual the
 * actions were trusted to consult. After it has been sent, these lines are
 * what the supplier was told to deliver and what GR/IR will be matched
 * against; amending means returning the order to draft, which is a decision
 * with a name on it.
 *
 * `amount`, `vat_amount` and `line_total` are GENERATED. Mongo computes the
 * same three in JavaScript with Math.round(x * 100) / 100 per step (§2.1).
 */
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),

    /** Null when the line buys something unstocked. Snapshot keeps it readable. */
    productId: uuid("product_id"),
    productName: text("product_name"),
    productSku: text("product_sku"),

    description: text("description").notNull(),

    /**
     * Where this lands in the books — a live reference, joined not copied
     * (§8.6). Nothing outside the company has seen this choice, so unlike the
     * supplier name it has no reason to be frozen.
     */
    accountId: uuid("account_id"),

    quantity: qty("quantity").notNull(),
    unit: text("unit").notNull().default("pcs"),
    unitPrice: money("unit_price").notNull(),
    vatRate: percent("vat_rate").notNull().default("0"),

    /** GENERATED. Read only. */
    amount: money("amount"),
    vatAmount: money("vat_amount"),
    lineTotal: money("line_total"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_order_lines_number_uq").on(
      t.purchaseOrderId,
      t.lineNumber,
    ),
    index("purchase_order_lines_po_idx").on(t.purchaseOrderId),
  ],
);
