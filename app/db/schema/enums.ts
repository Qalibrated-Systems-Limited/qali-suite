import { pgEnum } from "drizzle-orm/pg-core";

// Mirrors accountTypes in lib/utils.js
export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const journalStatusEnum = pgEnum("journal_status", [
  "draft",
  "posted",
  "reversed",
]);

export const partyTypeEnum = pgEnum("party_type", [
  "customer",
  "supplier",
  "employee",
  "other",
]);

export const fiscalPeriodStatusEnum = pgEnum("fiscal_period_status", [
  "open",
  "closed",
  "locked",
]);

// Mirrors the entryType enum on JournalEntry. Kept as a Postgres enum so an
// unknown type fails at write time rather than flowing into reports.
export const journalEntryTypeEnum = pgEnum("journal_entry_type", [
  "sale",
  "payment_received",
  "payment_made",
  "expense",
  "advance",
  "purchase",
  "adjustment",
  "opening_balance",
  "advance_settlement",
  "invoice_cancellation",
  "bill_cancellation",
  "closing",
  "transfer",
  "credit_note",
  "debit_note",
  "depreciation",
  "write_off",
  "payroll",
  "contra",
  "bank_entry",
  "cash_entry",
  "accrual",
  "revaluation",
  "tax",
  "inventory_adjustment",
  "liability_payment",
  "loan_disbursement",
  "goods_receipt",
  "goods_dispatch",
  "asset_disposal",
  "impairment",
  "other",
]);

// Replaces the 12 nullable *Id fields under JournalEntry.relatedDocuments.
export const sourceDocumentTypeEnum = pgEnum("source_document_type", [
  "invoice",
  "payment",
  "expense",
  "bill",
  "stock_movement",
  "weighbridge_ticket",
]);

// ── Invoices slice ───────────────────────────────────────────────────────────

export const costingMethodEnum = pgEnum("costing_method", [
  "average",
  "fifo",
  "lifo",
  "specific",
  "weighted_average",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "completed",
  "cancelled",
  "expired",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
  "overpaid",
]);

/**
 * Where an invoice line's stock came from — and therefore which inventory
 * account COGS credits.
 *
 * In Mongo this is inferred from whether a nullable nested field happens to
 * exist (`!!(item.relatedRequest?.requestId || ...)`), so "not from technician
 * stock" and "the field did not persist" are the same state, and nothing stops
 * two sources being set at once. See docs/POSTGRES-MIGRATION-PLAN.md §8.1.
 * Here it is mandatory and single-valued.
 */
export const fulfilmentSourceEnum = pgEnum("fulfilment_source", [
  "inventory",
  "stock_request",
  "checkout",
  "weighbridge",
]);

/**
 * Which system posted COGS for a line. Whichever gets there first wins, and
 * cogs_postings' primary key makes the second attempt a unique violation
 * rather than a duplicate posting — see §8.3.
 */
export const cogsSourceEnum = pgEnum("cogs_source", ["invoice", "weighbridge"]);

/**
 * Header-level provenance, stored on invoices and kept in step with the lines
 * by a trigger. Mongo stores this and the app reads it; it stays stored rather
 * than being derived on every read. `mixed` covers an invoice whose lines come
 * from more than one source, which the Mongo enum could not express.
 */
export const invoiceSourceTypeEnum = pgEnum("invoice_source_type", [
  "direct",
  "stock_request",
  "checkout",
  "weighbridge",
  "mixed",
]);

/**
 * Whether a document line sells a stocked product or a service.
 *
 * `credit_note_lines` has carried this since 0015; `invoice_lines` did not,
 * and had `product_id NOT NULL` — so a service line was expressible on the
 * credit note that reverses a sale but not on the invoice that makes it. See
 * migration 0025.
 */
export const lineItemTypeEnum = pgEnum("line_item_type", [
  "product",
  "service",
]);

/** Mirrors `serviceCategory` on invoice.js and quote.js. */
export const serviceCategoryEnum = pgEnum("service_category", [
  "labor", // hourly rate
  "mileage", // transport per km
  "accommodation", // nightouts, hotels
  "installation",
  "consultation",
  "maintenance",
  "repair",
  "other",
]);

// ── Payments ─────────────────────────────────────────────────────────────────

export const paymentTypeEnum = pgEnum("payment_type", ["received", "made"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "mpesa",
  "bank_transfer",
  "cheque",
  "card",
]);

export const paymentRecordStatusEnum = pgEnum("payment_record_status", [
  "draft",
  "pending_clearance",
  "confirmed",
  "cancelled",
]);

/** What an allocation settles. */
export const allocationDocumentTypeEnum = pgEnum("allocation_document_type", [
  "invoice",
  "bill",
]);

// ── Bills (accounts payable) ─────────────────────────────────────────────────

export const billStatusEnum = pgEnum("bill_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * Which account a bill line is charged to. Mongo restricts the line's
 * `account.type` to these two, and the choice decides the posting: an asset
 * line for a stocked product debits Inventory (or GR/IR under three-way
 * match), anything else debits the named account directly.
 */
export const billLineAccountTypeEnum = pgEnum("bill_line_account_type", [
  "expense",
  "asset",
]);

// ── Credit notes ─────────────────────────────────────────────────────────────

export const creditNoteStatusEnum = pgEnum("credit_note_status", [
  "draft",
  "issued",
  "applied",
  "void",
]);

export const creditNoteReasonEnum = pgEnum("credit_note_reason", [
  "return",
  "damaged",
  "overcharge",
  "cancellation",
  "discount",
  "defective",
  "other",
]);

export const creditNoteItemTypeEnum = pgEnum("credit_note_item_type", [
  "product",
  "service",
]);

// ── Fulfilment: stock requests, checkouts, weighbridge ───────────────────────

/** Mirrors `stockRequestTypes` in lib/utils.js. */
export const stockRequestTypeEnum = pgEnum("stock_request_type", [
  "sale", // direct sale → draft invoice at fulfilment
  "demo", // loan to customer → checkout, may convert to sale
  "installation", // installation job → checkout, accountant invoices
  "internal", // consumed internally → no invoice, no return
  "repair", // repair/service → checkout, usually returns
  "employee_borrow", // employee borrows for company use → must return
]);

export const stockRequestStatusEnum = pgEnum("stock_request_status", [
  "pending",
  "approved",
  "partially_fulfilled",
  "fulfilled",
  "invoiced",
  "rejected",
  "cancelled",
]);

/** Mirrors `priority` in lib/utils.js. */
export const requestPriorityEnum = pgEnum("request_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const requesterDepartmentEnum = pgEnum("requester_department", [
  "Technical",
  "Sales",
  "Service",
  "Installation",
  "Admin",
  "Finance",
  "Other",
]);

/** Mirrors `purposeForItemsRemovalFromStock` in lib/utils.js. */
export const stockRemovalPurposeEnum = pgEnum("stock_removal_purpose", [
  "sale",
  "technician_test",
  "customer_demo",
  "internal_use",
  "installation",
  "repair",
  "other",
]);

export const fulfilmentStatusEnum = pgEnum("fulfilment_status", [
  "pending",
  "partial",
  "complete",
]);

export const checkoutStatusEnum = pgEnum("checkout_status", [
  "checked_out",
  "returned",
  "overdue",
  "lost",
  "damaged",
  "converted_to_sale",
  "expensed",
]);

export const returnConditionEnum = pgEnum("return_condition", [
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
  "lost",
]);

/** Why stock must come back: the sale that justified issuing it did not land. */
export const returnRequiredReasonEnum = pgEnum("return_required_reason", [
  "invoice_expired",
  "invoice_cancelled",
  "sale_failed",
  "other",
]);

export const checkoutReminderTypeEnum = pgEnum("checkout_reminder_type", [
  "upcoming",
  "due_today",
  "overdue",
  "final_warning",
]);

export const checkoutReminderMethodEnum = pgEnum("checkout_reminder_method", [
  "email",
  "sms",
  "in_app",
]);

/**
 * What a weighbridge trip was for. Mirrors WB_TRANSACTION_TYPES.
 *
 * This is the field that drives the general ledger, and the model says so:
 * "transactionType drives all accounting — direction alone is insufficient.
 * Gate software must declare the purpose of each trip."
 */
export const wbTransactionTypeEnum = pgEnum("wb_transaction_type", [
  "purchase", // inbound from supplier, clears via bill → GR/IR
  "sale", // outbound to customer against an invoice
  "sale_standalone", // outbound to customer, no invoice
  "transfer_out", // outbound to own location
  "transfer_in", // inbound from own location
  "return_to_supplier",
  "customer_return",
]);

/** The truck's direction. Describes the movement, not the accounting. */
export const wbDirectionEnum = pgEnum("wb_direction", ["inbound", "outbound"]);

export const wbStatusEnum = pgEnum("wb_status", [
  "pending",
  "first_recorded",
  "completed",
  "voided",
]);

export const wbWeightUnitEnum = pgEnum("wb_weight_unit", ["kg", "t"]);

// ── Tax transactions ─────────────────────────────────────────────────────────

/**
 * Kenyan statutory taxes. Carried over from taxTransactions.js unchanged,
 * including `nhif` — replaced by SHIF in October 2024, but kept so historical
 * records still validate. Dropping it would make old rows unreadable, which is
 * the opposite of what a tax record is for.
 */
export const taxTypeEnum = pgEnum("tax_type", [
  // VAT
  "vat_input", // VAT on purchases (claimable)
  "vat_output", // VAT on sales (payable)
  // Withholding
  "wht", // withheld on supplier payments
  "wht_received", // certificate received from a customer
  // Payroll
  "paye",
  "nssf",
  "shif", // replaced NHIF, Oct 2024
  "nhif", // legacy, retained for historical records
  "housing_levy",
  // Other
  "excise_duty",
  "advance_tax",
  "dst", // Digital Services Tax
  "turnover_tax",
  "cgt", // Capital Gains Tax
  "other",
]);

/** What a tax transaction was raised from. */
export const taxSourceDocumentTypeEnum = pgEnum("tax_source_document_type", [
  "invoice",
  "bill",
  "journal_entry",
  "other",
]);

// ── Stock movements ──────────────────────────────────────────────────────────

export const movementTypeEnum = pgEnum("movement_type", [
  "issue",       // internal issue (loan/use)
  "return",      // return from loan
  "sale",        // sale to customer
  "purchase",    // purchase from supplier
  "adjustment",  // stock adjustment
  "damage",      // damaged goods write-off
  "transfer",    // transfer between locations
  "initial",     // opening balance
]);

export const movementDirectionEnum = pgEnum("movement_direction", ["in", "out"]);

export const movementStatusEnum = pgEnum("movement_status", [
  "pending",
  "completed",
  "reversed",
]);
