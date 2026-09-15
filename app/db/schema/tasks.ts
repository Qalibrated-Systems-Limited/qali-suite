/**
 * Tasks — 0109.
 *
 * The cross-department assignment spine: "who is doing what, by when." Replaces
 * the dummy-data Tasks page with a real, company-scoped, RLS'd table on the same
 * pattern as Help Desk (0104) and Licensing (0108).
 *
 * Integration seams, kept deliberately light so a task can hang off anything
 * without a table per source:
 *   - `assignedToUserId` → users (the person accountable); `assigneeName` is a
 *     denormalised snapshot so a list never needs the join.
 *   - `department` is free text, matching how Help Desk files its tickets.
 *   - `relatedEntityType` / `relatedEntityId` optionally link a task back to the
 *     document that spawned it (an invoice, a ticket, a bid…) — a soft link,
 *     not an FK, so any module can point at it.
 *
 * Priorities and statuses are text + CHECK, not pg enums, for the same reason
 * the Help Desk vocabularies are: small, likely to grow, cheap to evolve.
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

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** TSK-00001, from next_entry_number. */
    taskNumber: text("task_number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    department: text("department").notNull().default(""),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    assigneeName: text("assignee_name").notNull().default(""),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    source: text("source").notNull().default("manual"),
    /** Soft link to the document that spawned this task (no FK — any module). */
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: text("related_entity_id"),
    ...audit,
  },
  (t) => [
    uniqueIndex("tasks_company_number_idx").on(t.companyId, t.taskNumber),
    index("tasks_status_idx").on(t.companyId, t.status),
    index("tasks_priority_idx").on(t.companyId, t.priority),
    index("tasks_assignee_idx").on(t.companyId, t.assignedToUserId),
    index("tasks_due_idx").on(t.companyId, t.dueDate),
    check("tasks_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check("tasks_priority_valid", sql`${t.priority} IN ('low','medium','high','critical')`),
    check(
      "tasks_status_valid",
      sql`${t.status} IN ('open','in_progress','blocked','completed','cancelled')`,
    ),
    check("tasks_source_valid", sql`${t.source} IN ('manual','system')`),
  ],
);
