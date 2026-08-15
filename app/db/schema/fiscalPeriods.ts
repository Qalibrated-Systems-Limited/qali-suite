import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { fiscalPeriodStatusEnum } from "./enums";

/**
 * Fiscal periods gate posting: an entry cannot post into a closed or locked
 * period. In Mongo that check lives in JournalEntry.validateFiscalPeriod() and
 * was bypassable — entries created directly via the model never set
 * fiscalPeriodId. Here the check moves into the posting trigger (migration
 * 0001), which resolves the period from entry_date and cannot be skipped.
 *
 * `startDate`/`endDate` are `date`, not `timestamp` — a fiscal period is a
 * calendar boundary, and storing it as an instant made period resolution
 * timezone-sensitive.
 */
export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    year: integer("year").notNull(),
    month: integer("month").notNull(),
    periodName: text("period_name").notNull(),
    periodCode: text("period_code").notNull(),

    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),

    status: fiscalPeriodStatusEnum("status").notNull().default("open"),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedById: uuid("closed_by_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedById: uuid("locked_by_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("fiscal_periods_company_code_uq").on(t.companyId, t.periodCode),
    uniqueIndex("fiscal_periods_company_year_month_uq").on(
      t.companyId,
      t.year,
      t.month,
    ),
    // Covers the "which period contains this date" lookup done on every post.
    index("fiscal_periods_company_range_idx").on(
      t.companyId,
      t.startDate,
      t.endDate,
    ),
    check("fiscal_periods_month_range", sql`${t.month} BETWEEN 1 AND 12`),
    check("fiscal_periods_year_range", sql`${t.year} BETWEEN 2018 AND 2100`),
    check("fiscal_periods_date_order", sql`${t.endDate} > ${t.startDate}`),
  ],
);
