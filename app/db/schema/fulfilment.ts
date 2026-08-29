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
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { parties } from "./parties";
import { products } from "./products";
import { accounts } from "./accounts";
import { journalEntries } from "./journal";
import { projects, projectCostCodes } from "./projects";
import {
  stockRequestTypeEnum,
  stockRequestStatusEnum,
  requestPriorityEnum,
  requesterDepartmentEnum,
  stockRemovalPurposeEnum,
  fulfilmentStatusEnum,
  checkoutStatusEnum,
  returnConditionEnum,
  returnRequiredReasonEnum,
  checkoutReminderTypeEnum,
  checkoutReminderMethodEnum,
  wbTransactionTypeEnum,
  wbDirectionEnum,
  wbStatusEnum,
  wbWeightUnitEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });
const qty = (name: string) => numeric(name, { precision: 19, scale: 4 });

/**
 * Fulfilment — stock requests, item checkouts and weighbridge tickets.
 *
 * §9.6 step 5: the full models, replacing the minimal placeholders this file
 * held while the invoicing slices were built. Those carried just enough to make
 * §8.1's CHECK constraint meaningful — an invoice line naming a stock request
 * could not name one that did not exist. Everything else is added here.
 *
 * THE CORRECTION THIS SLICE MAKES (§9.9).
 *
 * §9.1 recorded "0 pre-save derived" for requests.js, and the model says why:
 *
 *     // NO PRE-SAVE MIDDLEWARE! (Transaction-safe)
 *     // We calculate manually in actions using helper methods
 *
 * That count was of hooks, not of derived values. There are five, and they are
 * maintained by `recalculateFulfillment()` — a method the caller has to
 * remember to invoke:
 *
 *     item.totalFulfilled       sum of the fulfillments array
 *     item.remainingToFulfill   max(0, target - totalFulfilled)
 *     item.fulfillmentStatus    pending / partial / complete
 *     request.status            promoted when all items complete
 *     request.totalValue        sum of quantity x unitPrice
 *
 * This is §8.4 in its least defensible form. A pre-save hook at least fires on
 * every save; a helper method fires only when someone calls it, and the code
 * removed the hook deliberately to make transactions work. Each of the five is
 * a generated column or a trigger here, so none of them can be forgotten.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Stock requests
// ─────────────────────────────────────────────────────────────────────────────

export const stockRequests = pgTable(
  "stock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    requestNumber: text("request_number").notNull(),
    requestType: stockRequestTypeEnum("request_type").notNull(),
    status: stockRequestStatusEnum("status").notNull().default("pending"),
    priority: requestPriorityEnum("priority").notNull().default("normal"),

    /**
     * Required for customer-facing types only — internal use and employee
     * borrow are intra-company and have no external customer. Mongo expresses
     * this with a `required` function on the field; here it is a CHECK, so it
     * holds for every writer rather than for document.validate().
     */
    customerId: uuid("customer_id"),
    customerNameAtRequest: text("customer_name_at_request"),
    customerEmailAtRequest: text("customer_email_at_request"),
    customerPhoneAtRequest: text("customer_phone_at_request"),
    customerAddressAtRequest: text("customer_address_at_request"),
    customerTaxPinAtRequest: text("customer_tax_pin_at_request"),

    requesterId: text("requester_id"),
    requesterNameAtRequest: text("requester_name_at_request").notNull(),
    requesterDepartment: requesterDepartmentEnum("requester_department").notNull(),
    requesterEmail: text("requester_email"),
    requesterPhone: text("requester_phone"),

    // ── Approval ─────────────────────────────────────────────────────────────
    approvedById: text("approved_by_id"),
    approvedByNameAtApproval: text("approved_by_name_at_approval"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalComments: text("approval_comments"),
    approvalConditions: text("approval_conditions"),

    rejectedById: text("rejected_by_id"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),

    /** Maintained from the items by trigger — see the note at the top. */
    totalValue: money("total_value").notNull().default("0"),

    notes: text("notes"),
    requiredByDate: date("required_by_date"),

    /** Raised at fulfilment for `sale`-type requests. */
    draftInvoiceId: uuid("draft_invoice_id"),
    draftInvoiceNumberAtCreation: text("draft_invoice_number_at_creation"),
    draftInvoiceCreatedAt: timestamp("draft_invoice_created_at", {
      withTimezone: true,
    }),

    /** Real references since 0070. See bills.project_id. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    projectNumberAtRequest: text("project_number_at_request"),
    projectNameAtRequest: text("project_name_at_request"),
    costCodeId: uuid("cost_code_id").references(() => projectCostCodes.id, {
      onDelete: "set null",
    }),
    costCodeAtRequest: text("cost_code_at_request"),

    createdById: text("created_by_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
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
    uniqueIndex("stock_requests_company_number_uq").on(
      t.companyId,
      t.requestNumber,
    ),
    uniqueIndex("stock_requests_id_company_uq").on(t.id, t.companyId),
    index("stock_requests_company_status_idx").on(t.companyId, t.status),
    index("stock_requests_company_type_status_idx").on(
      t.companyId,
      t.requestType,
      t.status,
    ),
    index("stock_requests_company_customer_idx").on(t.companyId, t.customerId),
    index("stock_requests_company_requester_idx").on(
      t.companyId,
      t.requesterId,
    ),
    // Drives the overdue/urgent queues, which are the ones anyone acts on.
    index("stock_requests_open_idx")
      .on(t.companyId, t.requiredByDate)
      .where(
        sql`${t.status} IN ('pending', 'approved', 'partially_fulfilled')`,
      ),
    check(
      "stock_requests_customer_required_unless_internal",
      sql`(${t.requestType} IN ('internal', 'employee_borrow'))
          OR (${t.customerId} IS NOT NULL AND ${t.customerNameAtRequest} IS NOT NULL)`,
    ),
    check("stock_requests_total_value_non_negative", sql`${t.totalValue} >= 0`),
  ],
);

export const stockRequestItems = pgTable(
  "stock_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    lineNumber: integer("line_number").notNull(),

    productId: uuid("product_id").notNull(),
    /** What the product was called and stocked at when the request was raised. */
    productNameAtRequest: text("product_name_at_request").notNull(),
    skuAtRequest: text("sku_at_request").notNull(),
    stockAtRequest: qty("stock_at_request").notNull(),

    requestedQuantity: qty("requested_quantity").notNull(),
    approvedQuantity: qty("approved_quantity"),
    unitPrice: money("unit_price").notNull().default("0"),
    unit: text("unit").notNull().default("pcs"),

    /** Legacy item-level purpose; the request-level type is authoritative. */
    purpose: stockRemovalPurposeEnum("purpose"),
    purposeDetails: text("purpose_details"),
    requiresReturn: boolean("requires_return").notNull().default(false),
    expectedReturnDate: date("expected_return_date"),
    notes: text("notes"),

    /**
     * DERIVED — maintained from the fulfilment rows by trigger. Mongo sums the
     * embedded array inside recalculateFulfillment(), which the caller must
     * remember to run.
     */
    totalFulfilled: qty("total_fulfilled").notNull().default("0"),
    /**
     * GENERATED. Note the absence of Mongo's `Math.max(0, ...)`: clamping at
     * zero would hide an over-fulfilment rather than show it, which is the
     * same defect §9.3 records against Payment.unappliedAmount. Over-fulfilment
     * is separately refused outright (migration 0021), so this cannot go
     * negative — but if it ever did, it would say so.
     */
    remainingToFulfil: qty("remaining_to_fulfil").generatedAlwaysAs(
      sql`COALESCE(approved_quantity, requested_quantity) - total_fulfilled`,
    ),
    /** DERIVED — set by trigger from total_fulfilled against the target. */
    fulfilmentStatus: fulfilmentStatusEnum("fulfilment_status")
      .notNull()
      .default("pending"),

    /** DERIVED — maintained from the item's invoice rows by trigger. */
    invoicedQuantity: qty("invoiced_quantity").notNull().default("0"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_request_items_request_line_uq").on(
      t.requestId,
      t.lineNumber,
    ),
    uniqueIndex("stock_request_items_id_company_uq").on(t.id, t.companyId),
    index("stock_request_items_request_idx").on(t.requestId),
    index("stock_request_items_company_product_idx").on(
      t.companyId,
      t.productId,
    ),
    check(
      "stock_request_items_requested_positive",
      sql`${t.requestedQuantity} > 0`,
    ),
    check(
      "stock_request_items_approved_within_requested",
      sql`${t.approvedQuantity} IS NULL
          OR (${t.approvedQuantity} >= 0 AND ${t.approvedQuantity} <= ${t.requestedQuantity})`,
    ),
    check(
      "stock_request_items_amounts_non_negative",
      sql`${t.unitPrice} >= 0 AND ${t.totalFulfilled} >= 0 AND ${t.invoicedQuantity} >= 0`,
    ),
  ],
);

/**
 * One row per issue against a request item.
 *
 * Mongo embeds these. They are unbounded — a request item can be fulfilled any
 * number of times — and each one links out to a stock movement, a checkout and
 * a delivery note, so this is a child table rather than an array.
 */
export const stockRequestFulfilments = pgTable(
  "stock_request_fulfilments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),

    quantity: qty("quantity").notNull(),
    /** Serials issued, where the product is serialised. */
    serialNumbers: text("serial_numbers").array(),

    fulfilledById: text("fulfilled_by_id"),
    fulfilledByNameAtFulfilment: text("fulfilled_by_name_at_fulfilment"),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** The stock that physically moved, and the checkout it created. */
    movementId: uuid("movement_id"),
    checkoutId: uuid("checkout_id"),
    /** Deferred reference — `delivery_notes` is not ported. */
    deliveryNoteId: uuid("delivery_note_id"),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stock_request_fulfilments_item_idx").on(t.itemId),
    index("stock_request_fulfilments_company_idx").on(t.companyId),
    check("stock_request_fulfilments_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

/** What of a request item has been invoiced, and on which invoice. */
export const stockRequestItemInvoices = pgTable(
  "stock_request_item_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),

    invoiceId: uuid("invoice_id").notNull(),
    invoiceNumberAtInvoicing: text("invoice_number_at_invoicing").notNull(),
    quantity: qty("quantity").notNull(),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_request_item_invoices_item_invoice_uq").on(
      t.itemId,
      t.invoiceId,
    ),
    index("stock_request_item_invoices_invoice_idx").on(t.invoiceId),
    check("stock_request_item_invoices_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

/** The approval trail. Append-only. */
export const stockRequestApprovals = pgTable(
  "stock_request_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    approverId: text("approver_id"),
    approverNameAtAction: text("approver_name_at_action").notNull(),
    action: text("action").notNull(),
    comments: text("comments"),
    actedAt: timestamp("acted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stock_request_approvals_request_idx").on(t.requestId),
    check(
      "stock_request_approvals_action_valid",
      sql`${t.action} IN ('approved', 'rejected', 'requested_changes')`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Item checkouts
// ─────────────────────────────────────────────────────────────────────────────

export const itemCheckouts = pgTable(
  "item_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    checkoutNumber: text("checkout_number").notNull(),
    productId: uuid("product_id").notNull(),
    /** What the product was called when it went out. */
    productNameAtCheckout: text("product_name_at_checkout"),
    skuAtCheckout: text("sku_at_checkout"),
    categoryAtCheckout: text("category_at_checkout"),

    quantity: qty("quantity").notNull(),
    serialNo: text("serial_no"),

    // ── Who has it ───────────────────────────────────────────────────────────
    checkedOutToId: text("checked_out_to_id"),
    checkedOutToNameAtCheckout: text("checked_out_to_name_at_checkout").notNull(),
    checkedOutToDepartment: text("checked_out_to_department"),
    checkedOutToEmail: text("checked_out_to_email"),
    checkedOutToPhone: text("checked_out_to_phone"),

    checkedOutById: text("checked_out_by_id"),
    checkedOutByNameAtCheckout: text("checked_out_by_name_at_checkout").notNull(),

    checkedOutAt: timestamp("checked_out_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    purpose: text("purpose").notNull(),
    purposeDetails: text("purpose_details"),
    expectedReturnDate: date("expected_return_date").notNull(),

    status: checkoutStatusEnum("status").notNull().default("checked_out"),

    // ── Return ───────────────────────────────────────────────────────────────
    actualReturnDate: date("actual_return_date"),
    returnedById: text("returned_by_id"),
    returnedByNameAtReturn: text("returned_by_name_at_return"),
    returnCondition: returnConditionEnum("return_condition"),
    returnNotes: text("return_notes"),
    damageDetails: text("damage_details"),

    /** The request this came from, and the movements either way. */
    requestId: uuid("request_id"),
    requestNumberAtCheckout: text("request_number_at_checkout"),
    movementId: uuid("movement_id"),
    returnMovementId: uuid("return_movement_id"),

    requestType: stockRequestTypeEnum("request_type"),

    // ── Conversion to sale ───────────────────────────────────────────────────
    saleConverted: boolean("sale_converted").notNull().default(false),
    saleConvertedAt: timestamp("sale_converted_at", { withTimezone: true }),
    saleConvertedById: text("sale_converted_by_id"),
    saleInvoiceId: uuid("sale_invoice_id"),
    saleInvoiceNumberAtConversion: text("sale_invoice_number_at_conversion"),
    quantitySold: qty("quantity_sold").notNull().default("0"),
    quantityReturned: qty("quantity_returned").notNull().default("0"),

    // ── Conversion to expense ────────────────────────────────────────────────
    expensed: boolean("expensed").notNull().default(false),
    expensedAt: timestamp("expensed_at", { withTimezone: true }),
    expensedById: text("expensed_by_id"),
    expenseAccountId: uuid("expense_account_id"),
    expenseAccountCodeAtExpense: text("expense_account_code_at_expense"),
    expenseAccountNameAtExpense: text("expense_account_name_at_expense"),
    expenseJournalEntryId: uuid("expense_journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    expenseReason: text("expense_reason"),
    quantityExpensed: qty("quantity_expensed").notNull().default("0"),
    expenseTotalCost: money("expense_total_cost").notNull().default("0"),

    // ── Return required: the sale that justified the issue did not land ──────
    returnRequired: boolean("return_required").notNull().default(false),
    returnRequiredReason: returnRequiredReasonEnum("return_required_reason"),
    returnRequiredAt: timestamp("return_required_at", { withTimezone: true }),
    returnRequiredById: text("return_required_by_id"),
    failedInvoiceId: uuid("failed_invoice_id"),
    failedInvoiceNumber: text("failed_invoice_number"),
    returnDeadline: date("return_deadline"),
    returnNotificationsSent: integer("return_notifications_sent")
      .notNull()
      .default(0),
    lastReturnNotificationAt: timestamp("last_return_notification_at", {
      withTimezone: true,
    }),

    customerId: uuid("customer_id"),
    customerNameAtCheckout: text("customer_name_at_checkout"),

    isEscalated: boolean("is_escalated").notNull().default(false),
    escalatedToId: text("escalated_to_id"),
    escalatedToNameAtEscalation: text("escalated_to_name_at_escalation"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalationReason: text("escalation_reason"),

    checkoutNotes: text("checkout_notes"),
    internalNotes: text("internal_notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("item_checkouts_company_number_uq").on(
      t.companyId,
      t.checkoutNumber,
    ),
    uniqueIndex("item_checkouts_id_company_uq").on(t.id, t.companyId),
    index("item_checkouts_company_status_idx").on(t.companyId, t.status),
    index("item_checkouts_company_holder_idx").on(
      t.companyId,
      t.checkedOutToId,
    ),
    index("item_checkouts_company_product_idx").on(t.companyId, t.productId),
    index("item_checkouts_request_idx").on(t.requestId),
    // The two queues anyone acts on: still out, and must come back.
    index("item_checkouts_outstanding_idx")
      .on(t.companyId, t.expectedReturnDate)
      .where(sql`${t.status} IN ('checked_out', 'overdue')`),
    index("item_checkouts_return_required_idx")
      .on(t.companyId, t.returnDeadline)
      .where(sql`${t.returnRequired} = true AND ${t.status} = 'checked_out'`),
    check("item_checkouts_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "item_checkouts_disposition_within_quantity",
      sql`${t.quantitySold} + ${t.quantityReturned} + ${t.quantityExpensed} <= ${t.quantity}`,
    ),
    check(
      "item_checkouts_disposition_non_negative",
      sql`${t.quantitySold} >= 0 AND ${t.quantityReturned} >= 0 AND ${t.quantityExpensed} >= 0`,
    ),
  ],
);

/** Reminder log for an outstanding checkout. */
export const checkoutReminders = pgTable(
  "checkout_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    checkoutId: uuid("checkout_id").notNull(),
    reminderType: checkoutReminderTypeEnum("reminder_type").notNull(),
    method: checkoutReminderMethodEnum("method").notNull(),
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("checkout_reminders_checkout_idx").on(t.checkoutId),
    index("checkout_reminders_company_sent_idx").on(t.companyId, t.sentAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Weighbridge tickets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two-pass weighing. A truck is weighed on arrival and on departure; the net is
 * the difference.
 *
 * `net_weight` is GENERATED as `abs(first - second)`, which is what the model's
 * own header comment says it is ("Net = |first − second|") and then stores as an
 * independent field that nothing reconciles. §8.4.
 *
 * `transaction_type` is the field that drives the ledger. The model is emphatic
 * that direction alone is not enough — an inbound truck may be a purchase, a
 * transfer in, or a customer return, and each posts differently.
 */
export const weighbridgeTickets = pgTable(
  "weighbridge_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    ticketNumber: text("ticket_number").notNull(),
    /** The gate software's own reference — the idempotency key. */
    externalRef: text("external_ref"),

    transactionType: wbTransactionTypeEnum("transaction_type").notNull(),
    direction: wbDirectionEnum("direction").notNull(),

    vehicleReg: text("vehicle_reg"),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),

    productId: uuid("product_id"),
    productNameAtTicket: text("product_name_at_ticket"),
    productCodeAtTicket: text("product_code_at_ticket"),

    /**
     * Supplier for a purchase or return, customer for a sale or customer
     * return, and the other location for a transfer — which is why the party is
     * nullable and un-keyed for transfers.
     */
    partyId: uuid("party_id"),
    partyNameAtTicket: text("party_name_at_ticket"),

    // ── Weights ──────────────────────────────────────────────────────────────
    firstWeight: qty("first_weight"),
    secondWeight: qty("second_weight"),
    /** GENERATED: |first - second|, as the model documents and then stores. */
    netWeight: qty("net_weight").generatedAlwaysAs(
      sql`abs(first_weight - second_weight)`,
    ),
    weightUnit: wbWeightUnitEnum("weight_unit").notNull().default("kg"),
    firstWeightRecordedAt: timestamp("first_weight_recorded_at", {
      withTimezone: true,
    }),
    secondWeightRecordedAt: timestamp("second_weight_recorded_at", {
      withTimezone: true,
    }),
    firstWeightKeyId: uuid("first_weight_key_id"),
    secondWeightKeyId: uuid("second_weight_key_id"),

    status: wbStatusEnum("status").notNull().default("pending"),
    ticketDate: date("ticket_date"),

    /** The ERP document created on completion. */
    internalRef: text("internal_ref"),
    internalId: uuid("internal_id"),

    /** Deferred reference — `purchase_orders` is not ported. */
    purchaseOrderId: uuid("purchase_order_id"),
    purchaseOrderRef: text("purchase_order_ref"),

    /**
     * Set for a sale. Decides which inventory counters move: against an
     * invoice, the commitment is released as the stock leaves; without one,
     * availability drops directly.
     */
    invoiceId: uuid("invoice_id"),
    invoiceRef: text("invoice_ref"),
    /**
     * Marks the invoice line as weighbridge-fulfilled, so invoice posting does
     * not post COGS a second time. The authoritative guard is cogs_postings'
     * primary key (§8.3); this stays as the flag the gate connector reads.
     */
    invoiceItemFulfilled: boolean("invoice_item_fulfilled")
      .notNull()
      .default(false),

    /** The bill that cleared GR/IR for an inbound purchase. */
    billId: uuid("bill_id"),
    billRef: text("bill_ref"),

    /**
     * Both legs of a transfer carry the same `transfer_ref` from the gate; the
     * connector links them when the inbound leg completes. `transfer_cleared`
     * means both legs matched and the goods-in-transit balance is zero.
     */
    transferRef: text("transfer_ref"),
    linkedTicketId: uuid("linked_ticket_id").references(
      (): AnyPgColumn => weighbridgeTickets.id,
      { onDelete: "restrict" },
    ),
    transferCleared: boolean("transfer_cleared").notNull().default(false),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: text("voided_by_id"),
    voidReason: text("void_reason"),
    notes: text("notes"),
    /** Non-blocking warnings raised on completion, surfaced in the UI. */
    warnings: text("warnings").array(),

    integrationKeyId: uuid("integration_key_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("weighbridge_tickets_company_number_uq").on(
      t.companyId,
      t.ticketNumber,
    ),
    uniqueIndex("weighbridge_tickets_id_company_uq").on(t.id, t.companyId),
    /**
     * The gate's reference is an idempotency key, so it is unique where it is
     * present. Mongo indexes it without uniqueness, which is what lets a
     * retried gate call create a second ticket for one trip.
     */
    uniqueIndex("weighbridge_tickets_external_ref_uq")
      .on(t.companyId, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
    index("weighbridge_tickets_company_status_idx").on(
      t.companyId,
      t.status,
      t.createdAt.desc(),
    ),
    index("weighbridge_tickets_company_type_idx").on(
      t.companyId,
      t.transactionType,
      t.createdAt.desc(),
    ),
    index("weighbridge_tickets_company_vehicle_idx").on(
      t.companyId,
      t.vehicleReg,
    ),
    index("weighbridge_tickets_transfer_ref_idx").on(
      t.companyId,
      t.transferRef,
    ),
    check(
      "weighbridge_tickets_weights_non_negative",
      sql`(${t.firstWeight} IS NULL OR ${t.firstWeight} >= 0)
          AND (${t.secondWeight} IS NULL OR ${t.secondWeight} >= 0)`,
    ),
    /** The truck's direction must agree with what the trip was for. */
    check(
      "weighbridge_tickets_direction_matches_type",
      sql`(${t.direction} = 'inbound'
             AND ${t.transactionType} IN ('purchase', 'transfer_in', 'customer_return'))
          OR (${t.direction} = 'outbound'
             AND ${t.transactionType} IN ('sale', 'sale_standalone', 'transfer_out', 'return_to_supplier'))`,
    ),
  ],
);
