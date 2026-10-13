/**
 * Sales commission — 0125.
 *
 * Adapted from the QSL ERP3 prototype's tiered-commission idea, built as a real
 * tenant-scoped module. A manager records, per staff member and month, the
 * revenue that person is credited for; the engine multiplies it by their tier's
 * multiplier (T1 1.0× … T4 2.0×) to produce the commission, and tracks it from
 * pending to paid. The "Top Earners" leaderboard ranks staff by commission.
 *
 * MANUAL by design (the chosen model): the revenue figure is entered, not
 * derived from invoices — so it works before rep-attribution exists in the data,
 * and a manager stays in control of what counts.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";
import { employees } from "./hr";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * The tiers and their multipliers — company-configurable. Seeded lazily with
 * the prototype's four (T1 1.0×, T2 1.25×, T3 1.5×, T4 2.0×) the first time a
 * company opens the module, then editable like any other data.
 */
export const commissionTiers = pgTable(
  "commission_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Short code shown as a badge — "T1".."T4", or whatever the company uses. */
    level: text("level").notNull(),
    name: text("name").notNull().default(""),
    /** Commission = revenue × multiplier. */
    multiplier: numeric("multiplier", { precision: 5, scale: 2, mode: "string" })
      .notNull()
      .default("1"),
    /** Informational for the manual model: the revenue a tier is meant for. */
    minRevenue: money("min_revenue"),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("commission_tiers_company_level_uq").on(
      t.companyId,
      sql`lower(${t.level})`,
    ),
    index("commission_tiers_company_sort_idx").on(t.companyId, t.sortOrder),
    check("commission_tiers_level_not_blank", sql`length(btrim(${t.level})) > 0`),
    check("commission_tiers_multiplier_nonneg", sql`${t.multiplier} >= 0`),
  ],
);

/**
 * One recorded commission: a staff member, a month, the revenue credited, the
 * tier applied (multiplier snapshotted so a later tier edit never rewrites
 * history), the resulting commission, and whether it has been paid.
 */
export const staffCommissions = pgTable(
  "staff_commissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** First day of the month the commission is for. */
    periodMonth: date("period_month").notNull(),
    revenueAmount: money("revenue_amount").notNull().default("0"),
    /** Snapshot of the tier and its multiplier at the time of recording. */
    tierLevel: text("tier_level").notNull().default(""),
    tierMultiplier: numeric("tier_multiplier", {
      precision: 5,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("1"),
    /** revenue × multiplier, computed and stored at write time. */
    commissionAmount: money("commission_amount").notNull().default("0"),
    status: text("status").notNull().default("pending"),
    paidOn: date("paid_on"),
    note: text("note").notNull().default(""),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("staff_commissions_company_month_idx").on(t.companyId, t.periodMonth),
    index("staff_commissions_company_employee_idx").on(
      t.companyId,
      t.employeeId,
    ),
    index("staff_commissions_company_status_idx").on(t.companyId, t.status),
    check(
      "staff_commissions_status_valid",
      sql`${t.status} IN ('pending', 'paid')`,
    ),
    check(
      "staff_commissions_amounts_nonneg",
      sql`${t.revenueAmount} >= 0 AND ${t.commissionAmount} >= 0`,
    ),
  ],
);
