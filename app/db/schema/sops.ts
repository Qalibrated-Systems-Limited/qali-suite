/**
 * SOP Library — 0115.
 *
 * Controlled documents and their review schedule, replacing the dummy SOP page.
 * One company-scoped, RLS'd table on the same pattern as the other modules.
 *
 * "Review due" is DERIVED from status + next_review at read time, never stored,
 * so the queue can't drift from the calendar. Codes come from
 * next_entry_number('SOP').
 */
import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";

const audit = {
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("System"),
  lastModifiedById: text("last_modified_by_id").references(() => users.id, { onDelete: "set null" }),
  lastModifiedByName: text("last_modified_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const sops = pgTable(
  "sops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** SOP-00001, from next_entry_number. */
    code: text("code").notNull(),
    title: text("title").notNull(),
    department: text("department").notNull().default(""),
    category: text("category").notNull().default(""),
    version: text("version").notNull().default("v1"),
    status: text("status").notNull().default("draft"),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    ownerName: text("owner_name").notNull().default(""),
    lastReviewed: date("last_reviewed"),
    nextReview: date("next_review"),
    reviewNote: text("review_note").notNull().default(""),
    fileUrl: text("file_url"),
    ...audit,
  },
  (t) => [
    uniqueIndex("sops_company_code_idx").on(t.companyId, t.code),
    index("sops_status_idx").on(t.companyId, t.status),
    index("sops_next_review_idx").on(t.companyId, t.nextReview),
    check("sops_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "sops_status_valid",
      sql`${t.status} IN ('draft','in_review','approved','retired')`,
    ),
  ],
);
