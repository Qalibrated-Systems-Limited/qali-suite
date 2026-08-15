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
