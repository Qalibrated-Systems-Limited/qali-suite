/**
 * Engineer's Instructions & Site Diary — 0075.
 *
 * The construction site-record half of the Projects module template
 * (`QaliTrack_PMS`): the log of instructions issued by the supervising
 * engineer or client, and the contractor's daily site diary. Two tables,
 * both company/project-scoped and audited the same way `project_tasks` is.
 * Numbered through the `next_entry_number` sequence the rest of the app
 * already uses ('EI', 'CSD'), not a bespoke counter.
 *
 * NEITHER TABLE STORES PHOTOS. The template's "attach photos as evidence"
 * needs an upload/storage path this pass does not build. A column with
 * nothing that writes to it is the `projects.financials` mistake this
 * schema's neighbour warns against, so it is left for whoever adds file
 * storage rather than declared here unused.
 *
 * Monthly Report has no table of its own — it composes these two plus
 * `getProjectProgress` and `getProjectFinancialSummary`, already read from
 * `projects.ts` and `project_tasks`.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
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
import {
  projectInstructionTypeEnum,
  projectInstructionStatusEnum,
  projectDiaryStatusEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

export const projectInstructions = pgTable(
  "project_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** EI-00001, from `next_entry_number`. */
    instructionNumber: text("instruction_number").notNull(),
    type: projectInstructionTypeEnum("type").notNull().default("instruction"),
    clauseReference: text("clause_reference").notNull().default(""),
    location: text("location").notNull().default(""),
    description: text("description").notNull(),
    estimatedCost: money("estimated_cost"),

    issuedDate: date("issued_date").notNull(),
    issuedByName: text("issued_by_name").notNull(),

    status: projectInstructionStatusEnum("status").notNull().default("pending"),
    responseNotes: text("response_notes"),
    respondedById: text("responded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    respondedByName: text("responded_by_name"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),

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
    uniqueIndex("project_instructions_company_number_idx").on(
      t.companyId,
      t.instructionNumber,
    ),
    index("project_instructions_project_idx").on(
      t.companyId,
      t.projectId,
      t.issuedDate,
    ),
    index("project_instructions_status_idx").on(
      t.companyId,
      t.projectId,
      t.status,
    ),

    check(
      "project_instructions_description_not_blank",
      sql`length(btrim(${t.description})) > 0`,
    ),
    check(
      "project_instructions_issued_by_not_blank",
      sql`length(btrim(${t.issuedByName})) > 0`,
    ),
    check(
      "project_instructions_cost_non_negative",
      sql`${t.estimatedCost} IS NULL OR ${t.estimatedCost} >= 0`,
    ),
    /** Both directions, same shape as `project_tasks_done_is_complete`. */
    check(
      "project_instructions_response_signed",
      sql`${t.status} = 'pending' OR (${t.respondedByName} IS NOT NULL AND ${t.respondedAt} IS NOT NULL)`,
    ),
  ],
);

export const projectDiaryEntries = pgTable(
  "project_diary_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** CSD-00001, from `next_entry_number`. */
    entryNumber: text("entry_number").notNull(),
    diaryDate: date("diary_date").notNull(),
    weather: text("weather").notNull().default(""),
    location: text("location").notNull().default(""),
    activities: text("activities").notNull(),
    plant: text("plant").notNull().default(""),
    manpowerCount: integer("manpower_count").notNull().default(0),
    incidentCount: integer("incident_count").notNull().default(0),
    incidentNotes: text("incident_notes").notNull().default(""),

    loggedByName: text("logged_by_name").notNull(),

    status: projectDiaryStatusEnum("status").notNull().default("submitted"),
    countersignedById: text("countersigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    countersignedByName: text("countersigned_by_name"),
    countersignedAt: timestamp("countersigned_at", { withTimezone: true }),

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
    /** One entry per day per project — the template's own rule. */
    uniqueIndex("project_diary_entries_project_date_idx").on(
      t.projectId,
      t.diaryDate,
    ),
    index("project_diary_entries_company_idx").on(
      t.companyId,
      t.projectId,
      t.diaryDate,
    ),
    index("project_diary_entries_status_idx").on(
      t.companyId,
      t.projectId,
      t.status,
    ),

    check(
      "project_diary_activities_not_blank",
      sql`length(btrim(${t.activities})) > 0`,
    ),
    check(
      "project_diary_logged_by_not_blank",
      sql`length(btrim(${t.loggedByName})) > 0`,
    ),
    check("project_diary_manpower_non_negative", sql`${t.manpowerCount} >= 0`),
    check("project_diary_incidents_non_negative", sql`${t.incidentCount} >= 0`),
    check(
      "project_diary_countersign_signed",
      sql`${t.status} = 'submitted' OR (${t.countersignedByName} IS NOT NULL AND ${t.countersignedAt} IS NOT NULL)`,
    ),
  ],
);
