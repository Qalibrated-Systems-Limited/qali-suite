import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Tenant root. Every other table in the accounting core carries a company_id
 * FK to this table and is protected by the RLS policy in
 * app/db/migrations/0001_rls_and_constraints.sql.
 *
 * This is the one table NOT under RLS — it is filtered by membership instead.
 */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  baseCurrency: text("base_currency").notNull().default("KES"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
