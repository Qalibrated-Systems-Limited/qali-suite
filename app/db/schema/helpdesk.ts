/**
 * Help Desk (Ticketing) — 0089.
 *
 * Ported from the Lante ERP Ticketing microservice
 * (packages/microservices/ticketing) into QaliSuite's Postgres/Drizzle stack.
 * The .NET service is a large surface (SLA policies, workflow engine, macros,
 * knowledge base, complaints); this brings across the core help-desk spine
 * that every one of those features hangs off — categories, tickets, threaded
 * comments and an append-only history — plus SLA response/resolution clocks
 * computed on the ticket itself (the repository stamps them from a priority
 * matrix, so a ticket carries its own deadlines without a separate policy
 * table to join). Everything is company-scoped, RLS'd and audited exactly the
 * way `workflow_reports` and the Technical tables are, and ticket numbers come
 * from the shared `next_entry_number` ('TKT').
 *
 * Statuses/priorities/sources are text + CHECK, not pg enums, for the same
 * reason the report `type` is: the vocabularies are small, may grow, and a
 * CHECK is cheaper to evolve than an enum.
 */
import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { projects } from "./projects";
import { users } from "./users";

const audit = {
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("System"),
  lastModifiedById: text("last_modified_by_id").references(() => users.id, { onDelete: "set null" }),
  lastModifiedByName: text("last_modified_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── Categories ────────────────────────────────────────────────────────────────
// TicketCategory in the .NET model: the taxonomy tickets are filed under, each
// carrying a default priority and the flags the workflow keys off (complaint,
// evidence-required). Seeded lazily with a standard set the first time a
// company opens the Help Desk (see repositories/helpdesk.ts).
export const helpdeskCategories = pgTable(
  "helpdesk_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    department: text("department").notNull().default(""),
    defaultPriority: text("default_priority").notNull().default("medium"),
    requiresEvidence: boolean("requires_evidence").notNull().default(false),
    isComplaint: boolean("is_complaint").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...audit,
  },
  (t) => [
    uniqueIndex("helpdesk_categories_company_name_idx").on(t.companyId, t.name),
    check("helpdesk_categories_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "helpdesk_categories_priority_valid",
      sql`${t.defaultPriority} IN ('low','medium','high','critical')`,
    ),
  ],
);

// ── Tickets ─────────────────────────────────────────────────────────────────
export const helpdeskTickets = pgTable(
  "helpdesk_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** TKT-00001, from next_entry_number. */
    ticketNumber: text("ticket_number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    categoryId: uuid("category_id").references(() => helpdeskCategories.id, { onDelete: "set null" }),
    categoryName: text("category_name").notNull().default(""),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("new"),
    source: text("source").notNull().default("manual"),
    department: text("department").notNull().default(""),
    /** The help-desk client (denormalised name; CRM/parties-swappable later). */
    customerName: text("customer_name").notNull().default(""),
    requesterName: text("requester_name").notNull().default(""),
    requesterEmail: text("requester_email").notNull().default(""),
    assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    assigneeName: text("assignee_name").notNull().default(""),
    /** Optional context link into Projects (LinkedEntityType.Project in .NET). */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    /** SLA clocks, stamped from the priority matrix on creation. */
    responseDueAt: timestamp("response_due_at", { withTimezone: true }),
    resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
    /** First public staff reply — Response SLA is met when this is set. */
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes").notNull().default(""),
    /** Root-cause, distinct from what was done — mandatory to resolve. */
    rootCause: text("root_cause").notNull().default(""),
    isEscalated: boolean("is_escalated").notNull().default(false),
    escalationLevel: text("escalation_level"),
    closureReason: text("closure_reason").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("helpdesk_tickets_company_number_idx").on(t.companyId, t.ticketNumber),
    index("helpdesk_tickets_status_idx").on(t.companyId, t.status),
    index("helpdesk_tickets_priority_idx").on(t.companyId, t.priority),
    index("helpdesk_tickets_assignee_idx").on(t.companyId, t.assignedToUserId),
    check("helpdesk_tickets_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "helpdesk_tickets_priority_valid",
      sql`${t.priority} IN ('low','medium','high','critical')`,
    ),
    check(
      "helpdesk_tickets_status_valid",
      sql`${t.status} IN ('new','assigned','in_progress','pending','escalated','resolved','closed','reopened')`,
    ),
    check(
      "helpdesk_tickets_source_valid",
      sql`${t.source} IN ('manual','system','crm','safety','scheduled')`,
    ),
  ],
);

// ── Comments (public replies + internal notes) ───────────────────────────────
export const helpdeskComments = pgTable(
  "helpdesk_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").notNull().references(() => helpdeskTickets.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull().default("Unknown"),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("helpdesk_comments_ticket_idx").on(t.ticketId, t.createdAt),
    check("helpdesk_comments_content_not_blank", sql`length(btrim(${t.content})) > 0`),
  ],
);

// ── History (append-only audit of every state change) ────────────────────────
export const helpdeskHistory = pgTable(
  "helpdesk_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").notNull().references(() => helpdeskTickets.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull().default("System"),
    action: text("action").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("helpdesk_history_ticket_idx").on(t.ticketId, t.occurredAt)],
);
