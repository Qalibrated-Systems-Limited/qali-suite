/**
 * Price history — 0069.
 *
 * Append-only: the app_user grant is SELECT and INSERT, with no UPDATE and no
 * DELETE, because a history somebody can edit answers no question worth asking.
 *
 * COST changes are not here. Cost moves on its own on every receipt and
 * adjustment, by weighted average, and logging each would bury the deliberate
 * changes under thousands of derived ones — `stock_movements` already carries
 * `unit_cost` and `average_cost_at_movement` for every movement that caused
 * one. `costAtChange` rides on each row so the margin at the time is
 * answerable without going back through the movements.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { products } from "./products";
import { users } from "./users";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/** The three prices a person sets. Cost is not one of them — see the header. */
export const PRICE_FIELDS = ["selling", "wholesale", "minimum"] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export const productPriceHistory = pgTable(
  "product_price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    field: text("field").notNull(),
    oldValue: money("old_value").notNull(),
    newValue: money("new_value").notNull(),
    /** The cost basis at the moment of the change. */
    costAtChange: money("cost_at_change").notNull().default("0"),

    reason: text("reason"),
    /**
     * The approval that released it. TEXT, not a foreign key — the
     * ApprovalRequest engine is still Mongo, so this holds its requestNumber
     * and cannot reference anything in this database.
     */
    approvalRef: text("approval_ref"),

    changedById: text("changed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    changedByName: text("changed_by_name").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("product_price_history_company_date_idx").on(t.companyId, t.changedAt),
    index("product_price_history_product_idx").on(t.productId, t.changedAt),

    check(
      "product_price_history_field_valid",
      sql`${t.field} IN ('selling', 'wholesale', 'minimum')`,
    ),
    check(
      "product_price_history_values_non_negative",
      sql`${t.oldValue} >= 0 AND ${t.newValue} >= 0 AND ${t.costAtChange} >= 0`,
    ),
    /** A row recording no change is noise that hides the signal. */
    check(
      "product_price_history_actually_changed",
      sql`${t.oldValue} <> ${t.newValue}`,
    ),
  ],
);
