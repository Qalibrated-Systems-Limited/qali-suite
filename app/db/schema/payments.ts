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
import { parties } from "./parties";
import { accounts } from "./accounts";
import { journalEntries } from "./journal";
import {
  paymentTypeEnum,
  paymentMethodEnum,
  paymentRecordStatusEnum,
  allocationDocumentTypeEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Payments received from customers and made to suppliers.
 *
 * Per docs/POSTGRES-MIGRATION-PLAN.md §9:
 *
 * DERIVED, not stored — `totalAllocated` and `unappliedAmount`. Mongo
 * recomputes both in a pre-save hook, so a write that bypasses the hook leaves
 * them stale, and `unappliedAmount = Math.max(0, amount - totalAllocated)`
 * clamps over-allocation to zero instead of surfacing it. Both come from the
 * payment_balances view (migration 0011).
 *
 * KEPT as snapshots — the party and account details. The model calls them
 * "Snapshot at payment time - won't change" and "Cached for display", and they
 * are exactly that: what the payment document recorded. They stay alongside the
 * foreign keys, immutable.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    paymentNumber: text("payment_number").notNull(),
    paymentType: paymentTypeEnum("payment_type").notNull(),
    paymentDate: date("payment_date").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),

    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("KES"),

    // ── Party: FK plus what the document said ──────────────────────────────
    partyId: uuid("party_id").notNull(),
    /** Snapshot at payment time — the model's own words. Immutable. */
    partyNameAtPayment: text("party_name_at_payment").notNull(),
    partyEmailAtPayment: text("party_email_at_payment"),
    partyPhoneAtPayment: text("party_phone_at_payment"),

    // ── Cash/bank account: FK plus what the document said ──────────────────
    accountId: uuid("account_id").notNull(),
    accountCodeAtPayment: text("account_code_at_payment").notNull(),
    accountNameAtPayment: text("account_name_at_payment").notNull(),

    // Method-specific references, flattened from the embedded blocks.
    mpesaReceipt: text("mpesa_receipt"),
    bankReference: text("bank_reference"),
    chequeNumber: text("cheque_number"),

    reference: text("reference"),
    description: text("description"),
    notes: text("notes"),

    status: paymentRecordStatusEnum("status").notNull().default("draft"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedById: uuid("confirmed_by_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id"),

    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),

    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_company_number_uq").on(t.companyId, t.paymentNumber),
    uniqueIndex("payments_id_company_uq").on(t.id, t.companyId),
    index("payments_company_party_idx").on(t.companyId, t.partyId),
    index("payments_company_date_idx").on(t.companyId, t.paymentDate.desc()),
    index("payments_company_status_idx").on(t.companyId, t.status),
    check("payments_amount_positive", sql`${t.amount} > 0`),
  ],
);

/**
 * What a payment settles.
 *
 * Mongo embeds these (bounded, always read together) — the same reasoning holds
 * here, but as a child table so the over-allocation constraint can be enforced
 * by the database rather than by a hook.
 *
 * The document number is snapshotted: an allocation records which invoice it
 * settled as that invoice was numbered at the time.
 */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").notNull(),

    documentType: allocationDocumentTypeEnum("document_type").notNull(),
    /**
     * Polymorphic by design: an allocation settles an invoice or a bill.
     * Validated by a trigger (migration 0011) rather than a foreign key, since
     * the target table depends on document_type.
     */
    documentId: uuid("document_id").notNull(),
    documentNumberAtAllocation: text("document_number_at_allocation").notNull(),

    /** The document's total and outstanding balance when this was applied. */
    originalAmount: money("original_amount").notNull(),
    balanceBefore: money("balance_before").notNull(),
    amountAllocated: money("amount_allocated").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One allocation per payment per document — settling the same invoice twice
    // from one payment is a duplicate, not two allocations.
    uniqueIndex("payment_allocations_payment_document_uq").on(
      t.paymentId,
      t.documentType,
      t.documentId,
    ),
    index("payment_allocations_document_idx").on(
      t.companyId,
      t.documentType,
      t.documentId,
    ),
    index("payment_allocations_payment_idx").on(t.paymentId),
    check("payment_allocations_amount_positive", sql`${t.amountAllocated} > 0`),
    check(
      "payment_allocations_balances_non_negative",
      sql`${t.originalAmount} >= 0 AND ${t.balanceBefore} >= 0`,
    ),
  ],
);
