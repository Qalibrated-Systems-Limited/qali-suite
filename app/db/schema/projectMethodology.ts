/**
 * Project methodology — the implementation method statement.
 *
 * Once a project's budget is APPROVED, the responsible department manager
 * writes how the works will be delivered: scope, approach, the sequence of
 * works, the resources, health & safety, quality control, a programme summary
 * and the risks. One method statement per project (a single editable record,
 * not versioned), sitting alongside the Bill of Quantities, Milestones and
 * Programme it plans against.
 *
 * The sections are discrete text columns rather than a JSON blob so a report,
 * a search or a later migration can read one section without parsing the rest.
 */
import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { projects } from "./projects";
import { users } from "./users";

export const projectMethodologies = pgTable(
  "project_methodologies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // The method-statement sections.
    scope: text("scope").notNull().default(""),
    approach: text("approach").notNull().default(""),
    sequenceOfWorks: text("sequence_of_works").notNull().default(""),
    resources: text("resources").notNull().default(""),
    healthSafety: text("health_safety").notNull().default(""),
    qualityControl: text("quality_control").notNull().default(""),
    programmeSummary: text("programme_summary").notNull().default(""),
    risks: text("risks").notNull().default(""),

    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, { onDelete: "set null" }),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One method statement per project.
    uniqueIndex("project_methodologies_project_uq").on(t.projectId),
  ],
);
