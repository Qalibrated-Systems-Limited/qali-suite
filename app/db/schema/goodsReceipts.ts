import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { journalEntries } from "./journal";
import { purchaseOrders, purchaseOrderLines } from "./purchaseOrders";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });
const qty = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Goods receipts (0050) — and the end of the GR/IR suspense account.
 *
 * Bills went to Postgres in 0015 carrying three-way match with them, while the
 * receipt that CLEARS GR/IR stayed in Mongo and cleared against the Mongo
 * ledger. Any tenant with `company_settings.require_grn` on has been
 * accumulating a clearing balance with no possible counterparty ever since.
 * This is the counterparty.
 *
 *   goods first (PO)     receipt: DR Inventory  CR GR/IR
 *                        bill:    DR GR/IR      CR Accounts Payable
 *
 *   bill first (strict)  bill:    DR GR/IR      CR Accounts Payable
 *                        receipt: DR Inventory  CR GR/IR
 *
 * `gr_ir_open_items` lists the positions that have not netted.
 *
 * `status` is only what somebody DID — draft, submitted, finalised, voided —
 * and a trigger holds it to that path, with voiding confined to drafts. What
 * the acceptance DECIDED ('accepted', 'partially_accepted', 'rejected') and
 * whether there was a discrepancy are read from the lines by
 * `goods_receipt_state`, so the header can no longer disagree with them.
 */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grnNumber: text("grn_number").notNull(),

    /** purchase_order | bill | unscheduled — a CHECK keeps it and the ids in step. */
    sourceType: text("source_type").notNull(),
    purchaseOrderId: uuid("purchase_order_id"),
    billId: uuid("bill_id"),
    proformaInvoiceNumber: text("proforma_invoice_number"),
    packingListNumber: text("packing_list_number"),

    supplierId: uuid("supplier_id"),
    supplierName: text("supplier_name"),

    /** draft | pending_acceptance | finalised | voided. */
    status: text("status").notNull().default("draft"),

    receivedDate: date("received_date").notNull(),
    receivedById: text("received_by_id"),
    receivedByName: text("received_by_name"),

    discrepancyNotes: text("discrepancy_notes"),
    notes: text("notes"),

    /**
     * The SOP requires written confirmation from BOTH Sales and Finance, so
     * each is its own sign-off. The separation-of-duties rules — the receiver
     * cannot sign, and one person cannot sign both halves — are CHECK
     * constraints rather than guards in the action, because a guard at one
     * call site is not a control.
     */
    salesAcceptedById: text("sales_accepted_by_id"),
    salesAcceptedByName: text("sales_accepted_by_name"),
    salesAcceptedAt: timestamp("sales_accepted_at", { withTimezone: true }),
    salesAcceptanceNotes: text("sales_acceptance_notes"),
    financeAcceptedById: text("finance_accepted_by_id"),
    financeAcceptedByName: text("finance_accepted_by_name"),
    financeAcceptedAt: timestamp("finance_accepted_at", { withTimezone: true }),
    financeAcceptanceNotes: text("finance_acceptance_notes"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),

    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id"),
    rejectedByName: text("rejected_by_name"),
    rejectionReason: text("rejection_reason"),

    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: text("voided_by_id"),
    voidedByName: text("voided_by_name"),
    voidReason: text("void_reason"),

    /**
     * The acceptance posting. Mongo raises this entry and records its id
     * nowhere, so a receipt cannot show what it posted and the ledger cannot
     * be walked back to the receipt.
     */
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
    uniqueIndex("goods_receipts_company_number_uq").on(t.companyId, t.grnNumber),
    index("goods_receipts_company_status_idx").on(
      t.companyId,
      t.status,
      t.receivedDate,
    ),
  ],
);

/**
 * Receipt lines.
 *
 * `purchase_order_line_id` is a direct foreign key, NOT a document_flow row.
 * §9G planned the latter; building it showed why it is wrong here. A
 * document_flow line row must carry a quantity, and `quote_line_invoiced`
 * works because an invoice line's quantity never moves. A receipt line's does
 * — received first, accepted later, by different people — so putting it in
 * document_flow would make a second, drifting copy of a number that lives
 * here. document_flow still carries the receipt-to-bill pairing, which is
 * genuinely many-to-many and where the quantity IS frozen.
 *
 * `unit_cost` is frozen when the receipt is written rather than looked up at
 * acceptance. Mongo finds the matching bill line BY PRODUCT ID, throws when
 * there is none, and silently takes the first when a bill has two lines for
 * the same product — two deliveries at two prices, which is ordinary.
 *
 * What arrived is frozen once the receipt is submitted; only the acceptance
 * decision may still move, and only while acceptance is outstanding.
 */
export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),

    /** Null for an unscheduled receipt, or a bill that carried no order. */
    purchaseOrderLineId: uuid("purchase_order_line_id"),

    productId: uuid("product_id").notNull(),
    productName: text("product_name").notNull(),
    productSku: text("product_sku"),
    description: text("description").notNull(),
    unit: text("unit").notNull().default("pcs"),

    expectedQuantity: qty("expected_quantity").notNull().default("0"),
    receivedQuantity: qty("received_quantity").notNull(),
    acceptedQuantity: qty("accepted_quantity").notNull().default("0"),
    /** GENERATED: received - accepted. */
    rejectedQuantity: qty("rejected_quantity"),

    unitCost: money("unit_cost").notNull().default("0"),
    /** GENERATED: accepted x unit cost — what the Inventory debit is worth. */
    acceptedValue: money("accepted_value"),

    packagingCondition: text("packaging_condition").notNull().default("good"),
    physicalCondition: text("physical_condition").notNull().default("good"),
    inspectionNotes: text("inspection_notes"),
    photoUrls: text("photo_urls").array().notNull().default([]),
    storageLocation: text("storage_location"),

    /** pending | accepted | rejected | hold. 'hold' awaits an NCR disposition. */
    lineStatus: text("line_status").notNull().default("pending"),
    rejectReason: text("reject_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("goods_receipt_lines_number_uq").on(
      t.goodsReceiptId,
      t.lineNumber,
    ),
    index("goods_receipt_lines_grn_idx").on(t.goodsReceiptId),
    index("goods_receipt_lines_product_idx").on(t.companyId, t.productId),
  ],
);
