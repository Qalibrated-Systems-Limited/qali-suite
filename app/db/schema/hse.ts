/**
 * Health, Safety & Environment (HSE) — 0090.
 *
 * Ported from the Lante ERP HSE microservice
 * (packages/microservices/hse) into QaliSuite's Postgres/Drizzle stack.
 * Replaces the dummy-data placeholder page with the module's real spine:
 * sites, the incident register (with NEMA/environment fields folded onto the
 * incident, matching the .NET EnvIncident 1:1 extension), corrective actions,
 * the RAMS library, PPE issues, toolbox talks, training records and statutory
 * inspections. Company-scoped, RLS'd and audited the same as every table
 * since 0001; incident numbers come from next_entry_number('HSE').
 *
 * Enums are represented as text + CHECK, consistent with the Technical and
 * Help Desk tables.
 */
import {
  pgTable,
  uuid,
  text,
  date,
  integer,
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

// ── Sites ──────────────────────────────────────────────────────────────────
export const hseSites = pgTable(
  "hse_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    location: text("location").notNull().default(""),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    projectName: text("project_name").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    ...audit,
  },
  (t) => [
    index("hse_sites_company_idx").on(t.companyId, t.name),
    check("hse_sites_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

// ── Incident register (near-miss → LTI), with the NEMA fields folded in ──────
export const hseIncidents = pgTable(
  "hse_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** HSE-00001, from next_entry_number. */
    incidentNumber: text("incident_number").notNull(),
    siteId: uuid("site_id").references(() => hseSites.id, { onDelete: "set null" }),
    siteName: text("site_name").notNull().default(""),
    type: text("type").notNull().default("near_miss"),
    severity: text("severity").notNull().default("low"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    reportedByName: text("reported_by_name").notNull().default(""),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    /** EnvIncident (1:1 optional in .NET) — NEMA-reportable environment event. */
    isEnvironmental: boolean("is_environmental").notNull().default(false),
    nemaRef: text("nema_ref").notNull().default(""),
    nemaNotificationRequired: boolean("nema_notification_required").notNull().default(false),
    nemaNotifiedAt: timestamp("nema_notified_at", { withTimezone: true }),
    ...audit,
  },
  (t) => [
    uniqueIndex("hse_incidents_company_number_idx").on(t.companyId, t.incidentNumber),
    index("hse_incidents_company_idx").on(t.companyId, t.occurredAt),
    index("hse_incidents_status_idx").on(t.companyId, t.status),
    check(
      "hse_incidents_type_valid",
      sql`${t.type} IN ('near_miss','first_aid','medical_treatment','lost_time_injury','positive_observation')`,
    ),
    check("hse_incidents_severity_valid", sql`${t.severity} IN ('none','low','medium','high','critical')`),
    check(
      "hse_incidents_status_valid",
      sql`${t.status} IN ('open','under_investigation','corrective_action_pending','closed')`,
    ),
  ],
);

// ── Corrective actions (hang off an incident) ────────────────────────────────
export const hseCorrectiveActions = pgTable(
  "hse_corrective_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    incidentId: uuid("incident_id").notNull().references(() => hseIncidents.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    ownerName: text("owner_name").notNull().default(""),
    status: text("status").notNull().default("open"),
    dueDate: date("due_date"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...audit,
  },
  (t) => [
    index("hse_corrective_actions_incident_idx").on(t.incidentId),
    index("hse_corrective_actions_status_idx").on(t.companyId, t.status),
    check("hse_corrective_actions_desc_not_blank", sql`length(btrim(${t.description})) > 0`),
    check(
      "hse_corrective_actions_status_valid",
      sql`${t.status} IN ('open','in_progress','completed','overdue')`,
    ),
  ],
);

// ── RAMS library (Risk Assessment & Method Statement) ────────────────────────
export const hseRams = pgTable(
  "hse_rams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id").references(() => hseSites.id, { onDelete: "set null" }),
    siteName: text("site_name").notNull().default(""),
    subcontractorName: text("subcontractor_name").notNull().default(""),
    title: text("title").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    fileUrl: text("file_url").notNull().default(""),
    issueNotes: text("issue_notes").notNull().default(""),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...audit,
  },
  (t) => [
    index("hse_rams_company_idx").on(t.companyId, t.title),
    index("hse_rams_status_idx").on(t.companyId, t.status),
    check("hse_rams_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "hse_rams_status_valid",
      sql`${t.status} IN ('draft','submitted','under_review','approved','rejected','expired')`,
    ),
  ],
);

// ── PPE issues ────────────────────────────────────────────────────────────────
export const hsePpeIssues = pgTable(
  "hse_ppe_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    employeeName: text("employee_name").notNull().default(""),
    item: text("item").notNull(),
    condition: text("condition").notNull().default("new"),
    issuedAt: date("issued_at"),
    returnedAt: date("returned_at"),
    replacementDueAt: date("replacement_due_at"),
    ...audit,
  },
  (t) => [
    index("hse_ppe_company_idx").on(t.companyId, t.issuedAt),
    check("hse_ppe_item_not_blank", sql`length(btrim(${t.item})) > 0`),
    check("hse_ppe_condition_valid", sql`${t.condition} IN ('new','good','worn','damaged')`),
  ],
);

// ── Toolbox talks ─────────────────────────────────────────────────────────────
// Per-attendee sign-off from the .NET junction table is condensed here to a
// signed count + names list, which keeps the register queryable without a
// second table and matches how the register is actually read.
export const hseToolboxTalks = pgTable(
  "hse_toolbox_talks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id").references(() => hseSites.id, { onDelete: "set null" }),
    siteName: text("site_name").notNull().default(""),
    supervisorName: text("supervisor_name").notNull().default(""),
    topic: text("topic").notNull(),
    heldOn: date("held_on"),
    attendeeCount: integer("attendee_count").notNull().default(0),
    attendees: text("attendees").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("hse_toolbox_company_idx").on(t.companyId, t.heldOn),
    check("hse_toolbox_topic_not_blank", sql`length(btrim(${t.topic})) > 0`),
  ],
);

// ── Training records ──────────────────────────────────────────────────────────
export const hseTrainingRecords = pgTable(
  "hse_training_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    employeeName: text("employee_name").notNull().default(""),
    course: text("course").notNull(),
    completedOn: date("completed_on"),
    expiresOn: date("expires_on"),
    certificateUrl: text("certificate_url").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("hse_training_company_idx").on(t.companyId, t.expiresOn),
    check("hse_training_course_not_blank", sql`length(btrim(${t.course})) > 0`),
  ],
);

// ── Statutory inspections ─────────────────────────────────────────────────────
export const hseStatutoryInspections = pgTable(
  "hse_statutory_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id").references(() => hseSites.id, { onDelete: "set null" }),
    siteName: text("site_name").notNull().default(""),
    equipment: text("equipment").notNull(),
    inspectorName: text("inspector_name").notNull().default(""),
    lastInspectedAt: date("last_inspected_at"),
    dueDate: date("due_date"),
    status: text("status").notNull().default("scheduled"),
    certificateUrl: text("certificate_url").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("hse_statutory_company_idx").on(t.companyId, t.dueDate),
    index("hse_statutory_status_idx").on(t.companyId, t.status),
    check("hse_statutory_equipment_not_blank", sql`length(btrim(${t.equipment})) > 0`),
    check(
      "hse_statutory_status_valid",
      sql`${t.status} IN ('scheduled','passed','failed','overdue')`,
    ),
  ],
);
