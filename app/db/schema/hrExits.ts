import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * Employee exits and final dues (migration 20261026T074746).
 *
 * An exit is drafted (clearance and dues editable), approved (dues frozen, the
 * employment ends, the accrual posts, loan instalments are recovered) and paid
 * (the payment posts). The lines are a stored statement, not derived: they are
 * what was given to the employee and posted, and the database refuses changes
 * to them once the exit leaves draft.
 */

export const EXIT_TYPES = [
  "resignation",
  "termination",
  "summary_dismissal",
  "redundancy",
  "retirement",
  "contract_end",
  "death",
  "mutual_separation",
] as const;
export type ExitType = (typeof EXIT_TYPES)[number];

export const EXIT_STATUSES = ["draft", "approved", "paid", "cancelled"] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];

export const employeeExits = pgTable(
  "employee_exits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    exitNumber: text("exit_number").notNull(),
    employeeId: uuid("employee_id").notNull(),

    exitType: text("exit_type").notNull(),
    status: text("status").notNull().default("draft"),

    noticeDate: date("notice_date"),
    lastWorkingDate: date("last_working_date").notNull(),
    noticePeriodDays: integer("notice_period_days").notNull().default(28),
    recoverNoticeShortfall: boolean("recover_notice_shortfall").notNull().default(false),
    dailyRate: numeric("daily_rate", { precision: 19, scale: 4 }),
    leaveDaysOverride: numeric("leave_days_override", { precision: 9, scale: 2 }),

    reason: text("reason"),
    exitInterviewNotes: text("exit_interview_notes"),

    grossEarnings: numeric("gross_earnings", { precision: 19, scale: 4 }).notNull().default("0"),
    paye: numeric("paye", { precision: 19, scale: 4 }).notNull().default("0"),
    nssf: numeric("nssf", { precision: 19, scale: 4 }).notNull().default("0"),
    shif: numeric("shif", { precision: 19, scale: 4 }).notNull().default("0"),
    housingLevy: numeric("housing_levy", { precision: 19, scale: 4 }).notNull().default("0"),
    employerNssf: numeric("employer_nssf", { precision: 19, scale: 4 }).notNull().default("0"),
    employerHousingLevy: numeric("employer_housing_levy", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    otherDeductions: numeric("other_deductions", { precision: 19, scale: 4 }).notNull().default("0"),
    netPay: numeric("net_pay", { precision: 19, scale: 4 }).notNull().default("0"),

    accrualJournalEntryId: uuid("accrual_journal_entry_id"),
    paymentJournalEntryId: uuid("payment_journal_entry_id"),
    paymentReference: text("payment_reference"),

    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id"),
    approvedByName: text("approved_by_name"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidById: text("paid_by_id"),
    paidByName: text("paid_by_name"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    cancelledByName: text("cancelled_by_name"),
    cancellationReason: text("cancellation_reason"),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("employee_exits_company_number_uq").on(t.companyId, t.exitNumber),
    index("employee_exits_company_status_idx").on(t.companyId, t.status, t.lastWorkingDate),
  ],
);

export const employeeExitClearanceItems = pgTable(
  "employee_exit_clearance_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    exitId: uuid("exit_id").notNull(),
    area: text("area").notNull(),
    item: text("item").notNull(),
    assetId: uuid("asset_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("pending"),
    note: text("note"),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedById: text("cleared_by_id"),
    clearedByName: text("cleared_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("employee_exit_clearance_exit_idx").on(t.exitId, t.sortOrder)],
);

export const employeeExitLines = pgTable(
  "employee_exit_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    exitId: uuid("exit_id").notNull(),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 9, scale: 2 }),
    rate: numeric("rate", { precision: 19, scale: 4 }),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    taxable: boolean("taxable").notNull().default(true),
    pensionable: boolean("pensionable").notNull().default(true),
    accountId: uuid("account_id"),
    isManual: boolean("is_manual").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("employee_exit_lines_exit_idx").on(t.exitId, t.sortOrder)],
);
