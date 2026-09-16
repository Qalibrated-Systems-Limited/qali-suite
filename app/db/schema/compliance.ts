/**
 * Compliance — 0116.
 *
 * Certificates, statutory obligations and their renewal tasks — replacing the
 * dummy Compliance page. Three company-scoped, RLS'd tables.
 *
 *   compliance_certificates — accreditations/permits with an expiry. Their
 *                             current / expiring / expired state is DERIVED from
 *                             the expiry date, never stored.
 *   compliance_obligations  — recurring statutory filings (VAT, PAYE, NSSF…),
 *                             each with an agency, next-due date and penalty.
 *   compliance_tasks        — the renewal/action tasks, optionally linked to the
 *                             certificate they renew (soft link, cascades on
 *                             cert delete).
 */
import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  index,
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

export const complianceCertificates = pgTable(
  "compliance_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
    responsibleName: text("responsible_name").notNull().default(""),
    reference: text("reference").notNull().default(""),
    issueDate: date("issue_date"),
    expiryDate: date("expiry_date"),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("compliance_cert_company_idx").on(t.companyId, t.expiryDate),
    check("compliance_cert_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const complianceObligations = pgTable(
  "compliance_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    agency: text("agency").notNull().default(""),
    nextDue: date("next_due"),
    frequency: text("frequency").notNull().default("monthly"),
    penalty: text("penalty").notNull().default(""),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("compliance_oblig_company_idx").on(t.companyId, t.nextDue),
    check("compliance_oblig_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "compliance_oblig_frequency_valid",
      sql`${t.frequency} IN ('monthly','quarterly','annual','one_off')`,
    ),
  ],
);

export const complianceTasks = pgTable(
  "compliance_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedName: text("assigned_name").notNull().default(""),
    dueDate: date("due_date"),
    status: text("status").notNull().default("open"),
    certificateId: uuid("certificate_id").references(() => complianceCertificates.id, { onDelete: "cascade" }),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("compliance_task_company_idx").on(t.companyId, t.status),
    index("compliance_task_due_idx").on(t.companyId, t.dueDate),
    check("compliance_task_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check("compliance_task_status_valid", sql`${t.status} IN ('open','in_progress','done')`),
  ],
);
