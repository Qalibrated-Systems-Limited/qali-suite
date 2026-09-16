/**
 * Quality Management System (QMS) — 0114.
 *
 * The ISO 9001 / 17025 quality spine, replacing the dummy QMS page. This is a
 * DIFFERENT domain from the materials `nonconformances` table (which tracks
 * goods-receipt / stock defects and their dispositions): here a
 * non-conformance is a QUALITY finding — from an audit, a customer complaint or
 * a supplier — that drives a CAPA with an effectiveness check, alongside the
 * internal-audit programme and the management-review record.
 *
 *   qms_nonconformances     — a quality NC (NC-####), against an ISO clause.
 *   qms_capas               — the corrective/preventive action (CAPA-####) that
 *                             answers an NC, with its own due date and an
 *                             effectiveness check. Cascades from its NC.
 *   qms_audits              — the internal-audit programme (AUD-####).
 *   qms_management_reviews  — the management-review record (MR-####).
 *
 * Company-scoped, RLS'd, on the same pattern as every other module.
 */
import {
  pgTable,
  uuid,
  text,
  date,
  integer,
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

// ── Non-conformances ────────────────────────────────────────────────────────────
export const qmsNonconformances = pgTable(
  "qms_nonconformances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    ncNumber: text("nc_number").notNull(),
    source: text("source").notNull().default("internal_audit"),
    category: text("category").notNull().default("process"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    isoClause: text("iso_clause").notNull().default(""),
    severity: text("severity").notNull().default("minor"),
    status: text("status").notNull().default("open"),
    rootCause: text("root_cause").notNull().default(""),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    ownerName: text("owner_name").notNull().default(""),
    dueDate: date("due_date"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...audit,
  },
  (t) => [
    uniqueIndex("qms_nc_company_number_idx").on(t.companyId, t.ncNumber),
    index("qms_nc_status_idx").on(t.companyId, t.status),
    check("qms_nc_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "qms_nc_source_valid",
      sql`${t.source} IN ('internal_audit','external_audit','customer_complaint','supplier','process','product','other')`,
    ),
    check(
      "qms_nc_category_valid",
      sql`${t.category} IN ('process','product','system','external','other')`,
    ),
    check("qms_nc_severity_valid", sql`${t.severity} IN ('minor','major','critical')`),
    check(
      "qms_nc_status_valid",
      sql`${t.status} IN ('open','capa_in_progress','effectiveness_check','closed','cancelled')`,
    ),
  ],
);

// ── CAPA (corrective / preventive actions) ──────────────────────────────────────
export const qmsCapas = pgTable(
  "qms_capas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    capaNumber: text("capa_number").notNull(),
    nonconformanceId: uuid("nonconformance_id").notNull().references(() => qmsNonconformances.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("corrective"),
    action: text("action").notNull().default(""),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    ownerName: text("owner_name").notNull().default(""),
    dueDate: date("due_date"),
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    effectivenessDue: date("effectiveness_due"),
    effectivenessResult: text("effectiveness_result").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedByName: text("verified_by_name").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("qms_capa_company_number_idx").on(t.companyId, t.capaNumber),
    index("qms_capa_nc_idx").on(t.nonconformanceId),
    index("qms_capa_status_idx").on(t.companyId, t.status),
    check("qms_capa_type_valid", sql`${t.type} IN ('corrective','preventive')`),
    check(
      "qms_capa_status_valid",
      sql`${t.status} IN ('open','in_progress','completed','verified','cancelled')`,
    ),
    check(
      "qms_capa_effectiveness_valid",
      sql`${t.effectivenessResult} IN ('pending','effective','not_effective')`,
    ),
  ],
);

// ── Internal audit programme ─────────────────────────────────────────────────────
export const qmsAudits = pgTable(
  "qms_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    auditNumber: text("audit_number").notNull(),
    title: text("title").notNull(),
    standard: text("standard").notNull().default(""),
    auditorUserId: text("auditor_user_id").references(() => users.id, { onDelete: "set null" }),
    auditorName: text("auditor_name").notNull().default(""),
    department: text("department").notNull().default(""),
    plannedDate: date("planned_date"),
    completedDate: date("completed_date"),
    findings: text("findings").notNull().default(""),
    findingsCount: integer("findings_count").notNull().default(0),
    status: text("status").notNull().default("planned"),
    ...audit,
  },
  (t) => [
    uniqueIndex("qms_audit_company_number_idx").on(t.companyId, t.auditNumber),
    index("qms_audit_status_idx").on(t.companyId, t.status),
    check("qms_audit_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "qms_audit_status_valid",
      sql`${t.status} IN ('planned','in_progress','closed','cancelled')`,
    ),
  ],
);

// ── Management review ────────────────────────────────────────────────────────────
export const qmsManagementReviews = pgTable(
  "qms_management_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    reviewNumber: text("review_number").notNull(),
    reviewDate: date("review_date"),
    chairedBy: text("chaired_by").notNull().default(""),
    attendees: text("attendees").notNull().default(""),
    status: text("status").notNull().default("scheduled"),
    decisions: text("decisions").notNull().default(""),
    actionsCount: integer("actions_count").notNull().default(0),
    ...audit,
  },
  (t) => [
    uniqueIndex("qms_mr_company_number_idx").on(t.companyId, t.reviewNumber),
    index("qms_mr_status_idx").on(t.companyId, t.status),
    check("qms_mr_status_valid", sql`${t.status} IN ('scheduled','held','cancelled')`),
  ],
);
