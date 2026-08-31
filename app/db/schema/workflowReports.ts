/**
 * Workflow Reports — 0076.
 *
 * The project-scoped, reviewable report that the standalone "Workflow Reports"
 * app was built to produce, brought into the ERP as a Projects-module feature
 * that FEEDS FROM the project record rather than a database of its own. A
 * report names a project, a reporting period and a narrative (summary, work
 * completed, issues, next steps), and moves through a four-state review
 * workflow — draft → submitted → reviewed → approved.
 *
 * ONE TABLE, company/project-scoped and audited exactly like
 * `project_instructions` (0075). Numbered through the shared
 * `next_entry_number(company_id, 'WFR')` sequence, not a bespoke counter.
 *
 * IT STORES A SNAPSHOT, NOT A LIVE JOIN. When a report is submitted the three
 * project figures it quotes — schedule progress, invoiced-to-date, supplier
 * cost — are copied onto the row (`snapshot_*`). The reason is the same one
 * `projects.ts` gives for computing financials on read: those numbers keep
 * moving after the report is signed, and a report is a statement about the
 * project *as it stood on the reporting date*. Reading them live would make an
 * approved report silently disagree with itself a month later. The snapshot
 * columns are null until first submission and are refreshed on each resubmit.
 *
 * NO PHOTOS / ATTACHMENTS. Same call as `projectLogs.ts`: the field app's
 * "attach evidence" needs an upload/storage path this pass does not build, and
 * a column nothing writes to is the mistake `projects.ts` warns against, so it
 * is left for whoever adds file storage.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { projects } from "./projects";
import { users } from "./users";
import { workflowReportStatusEnum } from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

export const workflowReports = pgTable(
  "workflow_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /**
     * Serial, issued per sheet — the number sequence is keyed on the sheet
     * code, so it reads "WB01-00001" (shown as QSL-WB01-00001).
     */
    reportNumber: text("report_number").notNull(),
    /**
     * The QSL sheet code — WB01–WB06, SI01, TR01. Stored as free text, not an
     * enum, so the sheet catalogue in `app/dashboard/technical/lib/meta.js` can
     * gain or rename sheets without a schema migration.
     */
    type: text("type").notNull().default("TR01"),
    title: text("title").notNull(),

    /** The reporting window this report covers. Both optional. */
    periodStart: date("period_start"),
    periodEnd: date("period_end"),

    /** The narrative — only the summary is required. */
    summary: text("summary").notNull(),
    workCompleted: text("work_completed").notNull().default(""),
    issues: text("issues").notNull().default(""),
    nextSteps: text("next_steps").notNull().default(""),

    /**
     * The sheet's structured answers — the QSL form body. Shape is decided by
     * the chosen sheet's template (app/dashboard/technical/lib/templates.js):
     * `{ header:{client,site,weighbridge}, values:{}, checks:{}, runs:{}, grids:{} }`.
     * Free-form JSON on purpose so a new sheet or field needs no migration.
     */
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),

    status: workflowReportStatusEnum("status").notNull().default("draft"),

    /**
     * The project figures as they stood when the report was submitted. Null
     * until first submission; see the file header on why they are copied, not
     * joined. `snapshot_progress` is a whole-number percent (0–100).
     */
    snapshotProgress: integer("snapshot_progress"),
    snapshotRevenue: money("snapshot_revenue"),
    snapshotCost: money("snapshot_cost"),
    submittedByName: text("submitted_by_name"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    reviewedById: text("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByName: text("approved_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workflow_reports_company_number_idx").on(
      t.companyId,
      t.reportNumber,
    ),
    index("workflow_reports_project_idx").on(
      t.companyId,
      t.projectId,
      t.createdAt,
    ),
    index("workflow_reports_status_idx").on(
      t.companyId,
      t.projectId,
      t.status,
    ),

    check(
      "workflow_reports_title_not_blank",
      sql`length(btrim(${t.title})) > 0`,
    ),
    check(
      "workflow_reports_summary_not_blank",
      sql`length(btrim(${t.summary})) > 0`,
    ),
    /** If both period ends are given, start cannot fall after end. */
    check(
      "workflow_reports_period_ordered",
      sql`${t.periodStart} IS NULL OR ${t.periodEnd} IS NULL OR ${t.periodStart} <= ${t.periodEnd}`,
    ),
    check(
      "workflow_reports_progress_range",
      sql`${t.snapshotProgress} IS NULL OR (${t.snapshotProgress} >= 0 AND ${t.snapshotProgress} <= 100)`,
    ),
    /**
     * A report is only out of draft once someone has submitted it — the
     * submitter's name and timestamp are what the workflow is signed with.
     * Same shape as `project_instructions_response_signed`.
     */
    check(
      "workflow_reports_submission_signed",
      sql`${t.status} = 'draft' OR (${t.submittedByName} IS NOT NULL AND ${t.submittedAt} IS NOT NULL)`,
    ),
    /** Reviewed and approved both need a name and a time on the row. */
    check(
      "workflow_reports_review_signed",
      sql`${t.status} IN ('draft', 'submitted') OR (${t.reviewedByName} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)`,
    ),
    check(
      "workflow_reports_approval_signed",
      sql`${t.status} <> 'approved' OR (${t.approvedByName} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`,
    ),
  ],
);
