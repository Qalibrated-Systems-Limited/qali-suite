/**
 * Technical department — Calibration (ISO/IEC 17025) & Inspection (ISO/IEC
 * 17020) — 0079.
 *
 * Replaces the dummy-data demo pages with real, company-scoped, RLS'd tables.
 * Statuses are text + CHECK (not pg enums) for the same reason the report
 * `type` is text: the vocabularies are small and may grow, and a CHECK is
 * cheaper to evolve than an enum. Every table is audited the same way
 * `workflow_reports` is and numbered through the shared `next_entry_number`.
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

// ── Calibration: reference standards ─────────────────────────────────────────
export const calibrationStandards = pgTable(
  "calibration_standards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    traceability: text("traceability").notNull().default(""),
    lastCalibration: date("last_calibration"),
    nextCalibration: date("next_calibration"),
    uncertainty: text("uncertainty").notNull().default(""),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("calibration_standards_company_idx").on(t.companyId, t.nextCalibration),
    check("calibration_standards_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

// ── Calibration: jobs (a completed+passed job is a certificate) ──────────────
export const calibrationJobs = pgTable(
  "calibration_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** JOB-00001, from next_entry_number. */
    jobNumber: text("job_number").notNull(),
    clientName: text("client_name").notNull(),
    site: text("site").notNull().default(""),
    serviceType: text("service_type").notNull().default(""),
    scheduledDate: date("scheduled_date"),
    technicianName: text("technician_name").notNull().default(""),
    status: text("status").notNull().default("scheduled"),
    result: text("result").notNull().default("pending"),
    /** CERT-00001, stamped when a passed job issues its certificate. */
    certNumber: text("cert_number").notNull().default(""),
    billingStatus: text("billing_status").notNull().default("pending"),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("calibration_jobs_company_number_idx").on(t.companyId, t.jobNumber),
    index("calibration_jobs_company_idx").on(t.companyId, t.scheduledDate),
    index("calibration_jobs_status_idx").on(t.companyId, t.status),
    check("calibration_jobs_client_not_blank", sql`length(btrim(${t.clientName})) > 0`),
    check(
      "calibration_jobs_status_valid",
      sql`${t.status} IN ('scheduled','in_progress','completed','cancelled')`,
    ),
    check("calibration_jobs_result_valid", sql`${t.result} IN ('pending','passed','failed')`),
    check("calibration_jobs_billing_valid", sql`${t.billingStatus} IN ('pending','invoiced')`),
  ],
);

// ── Inspection (ISO 17020) ───────────────────────────────────────────────────
export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** INS-00001, from next_entry_number. */
    inspectionNumber: text("inspection_number").notNull(),
    type: text("type").notNull().default(""),
    equipmentSerial: text("equipment_serial").notNull().default(""),
    clientName: text("client_name").notNull(),
    inspectorName: text("inspector_name").notNull().default(""),
    scheduledDate: date("scheduled_date"),
    ruling: text("ruling").notNull().default("pending"),
    appealStatus: text("appeal_status").notNull().default("none"),
    authorityExpiry: date("authority_expiry"),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("inspections_company_number_idx").on(t.companyId, t.inspectionNumber),
    index("inspections_company_idx").on(t.companyId, t.scheduledDate),
    index("inspections_ruling_idx").on(t.companyId, t.ruling),
    check("inspections_client_not_blank", sql`length(btrim(${t.clientName})) > 0`),
    check(
      "inspections_ruling_valid",
      sql`${t.ruling} IN ('pending','pass','fail','quarantined')`,
    ),
    check(
      "inspections_appeal_valid",
      sql`${t.appealStatus} IN ('none','open','upheld','dismissed')`,
    ),
  ],
);
