import { pgTable, uuid, text, date, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";

/**
 * A technician, vehicle or piece of equipment requested for a piece of work
 * and a period, approved or rejected by the technical manager. See migration
 * 20261123T075116_technical_resources_are_requested_and_approved.sql.
 */
export const resourceRequests = pgTable(
  "resource_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    requestNumber: text("request_number").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    resourceName: text("resource_name").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    sourceRef: text("source_ref").notNull().default(""),
    sourceTitle: text("source_title").notNull().default(""),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("pending"),
    requestedById: text("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    requestedByName: text("requested_by_name").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedById: text("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("resource_requests_company_number_idx").on(t.companyId, t.requestNumber),
    index("resource_requests_queue_idx").on(t.companyId, t.status, t.startDate),
    index("resource_requests_resource_idx").on(t.companyId, t.resourceType, t.resourceId, t.startDate, t.endDate),
    check("resource_requests_type_valid", sql`${t.resourceType} IN ('technician','vehicle','equipment')`),
    check(
      "resource_requests_source_valid",
      sql`${t.sourceType} IN ('ticket','project_task','project','contract','calibration_job','inspection','other')`,
    ),
    check("resource_requests_status_valid", sql`${t.status} IN ('pending','approved','rejected','cancelled')`),
    check("resource_requests_dates_valid", sql`${t.endDate} >= ${t.startDate}`),
    check(
      "resource_requests_decided",
      sql`${t.status} IN ('pending','cancelled') OR (${t.decidedAt} IS NOT NULL AND ${t.decidedByName} IS NOT NULL)`,
    ),
    check(
      "resource_requests_rejection_explained",
      sql`${t.status} <> 'rejected' OR length(btrim(${t.decisionNote})) > 0`,
    ),
  ],
);
