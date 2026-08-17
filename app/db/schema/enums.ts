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
