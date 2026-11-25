import { pgTable, uuid, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies";

/** Saved custom reports. See each_module_keeps_saved_custom_reports. */
export const reportDefinitions = pgTable(
  "report_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    shared: boolean("shared").notNull().default(true),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_definitions_company_module_idx").on(t.companyId, t.module, t.name)],
);
