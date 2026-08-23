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
import { accounts } from "./accounts";
import { parties } from "./parties";
import { users } from "./users";
import { pettyCashReturnStatusEnum } from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Petty cash returns — the period statement the custodian signs and the MD
 * approves. The LAST module out of the Mongo ledger (0060).
 *
 * The LINES ARE NOT STORED and never were: they are derived from the GL for
 * the period by `computePettyCashStatement` — expenses paid from the float are
 * credits, journal entries debiting it are top-ups. That design is right and
 * is kept. What changes is what happens to the figures once they are signed.
 *
 * THE FROZEN COLUMNS. Mongo freezes the totals onto the return at submit and
 * again at approve — and then `getPettyCashReturnById` spreads the return and
 * overwrites both with a live recomputation, so the detail page of an APPROVED
 * return shows figures that were never approved. Book an expense afterwards
 * dated inside the period and the signed return silently changes. Here the
 * freeze is columns, the live statement is offered beside it, and a drift
 * between the two is something a screen can report rather than hide.
 *
 * Null while a draft: a draft has a live figure, not a frozen one, and storing
 * zero would make "not yet frozen" and "frozen at zero" the same state.
 *
 * MONEY IS A STRING — numeric(19,4). Do not Number() these.
 */
export const pettyCashReturns = pgTable(
  "petty_cash_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    documentNumber: text("document_number").notNull(),

    /** The tin. Several floats per company, which is why the overlap
     * constraint is per float rather than per company. */
    floatAccountId: uuid("float_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),

    custodianUserId: text("custodian_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    custodianPartyId: uuid("custodian_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    /** §9.4 — a renamed custodian must not rewrite a return they signed. */
    custodianNameAtReturn: text("custodian_name_at_return"),

    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),

    // ── The frozen statement ────────────────────────────────────────────────
    openingBalance: money("opening_balance"),
    totalDebits: money("total_debits"),
    totalCredits: money("total_credits"),
    /** GENERATED. Mongo stores this and recomputes it by hand. */
    closingBalance: money("closing_balance").generatedAlwaysAs(
      sql`opening_balance + total_debits - total_credits`,
    ),
    /** What the GL said the float held when the freeze happened, so the
     * signed over/short stays the signed over/short. */
    glClosingBalance: money("gl_closing_balance"),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),

    status: pettyCashReturnStatusEnum("status").notNull().default("draft"),

    preparedById: text("prepared_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    reviewedById: text("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    rejectionReason: text("rejection_reason"),
    notes: text("notes"),

    createdById: text("created_by_id").references(() => users.id, {
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
    uniqueIndex("petty_cash_returns_number_unique").on(
      t.companyId,
      t.documentNumber,
    ),
    index("petty_cash_returns_list_idx").on(
      t.companyId,
      t.periodFrom,
      t.status,
    ),
    index("petty_cash_returns_float_idx").on(
      t.companyId,
      t.floatAccountId,
      t.status,
    ),

    check("petty_cash_returns_period_ordered", sql`${t.periodTo} >= ${t.periodFrom}`),
    /**
     * The three frozen figures move together, and `frozen_at` says when.
     * Without this, `closing_balance` would be NULL whenever any one of them
     * was — which reads as "no closing balance" rather than as a bug.
     */
    check(
      "petty_cash_returns_freeze_is_whole",
      sql`(${t.openingBalance} IS NULL AND ${t.totalDebits} IS NULL
           AND ${t.totalCredits} IS NULL AND ${t.frozenAt} IS NULL)
          OR (${t.openingBalance} IS NOT NULL AND ${t.totalDebits} IS NOT NULL
           AND ${t.totalCredits} IS NOT NULL AND ${t.frozenAt} IS NOT NULL)`,
    ),
    check(
      "petty_cash_returns_submitted_is_frozen",
      sql`${t.status} = 'draft' OR ${t.frozenAt} IS NOT NULL`,
    ),
    check(
      "petty_cash_returns_totals_non_negative",
      sql`${t.totalDebits} IS NULL OR (${t.totalDebits} >= 0 AND ${t.totalCredits} >= 0)`,
    ),
    check(
      "petty_cash_returns_rejection_has_reason",
      sql`${t.status} <> 'rejected'
          OR (${t.rejectionReason} IS NOT NULL AND btrim(${t.rejectionReason}) <> '')`,
    ),
    // The EXCLUDE constraint that makes one-return-per-float-per-period true
    // lives in the migration: Drizzle has no builder for an exclusion
    // constraint, so declaring it here would be a comment pretending to be
    // code. See 0060.
  ],
);
