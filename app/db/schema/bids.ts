/**
 * Bids & Pre-Sales — 0111.
 *
 * Tenders the business is chasing, their compliance state and where each sits in
 * the pipeline. One real, company-scoped, RLS'd table replaces the dummy Bids
 * page; the "Pipeline" tab is simply the open subset with a win probability.
 *
 * Integration is kept soft: owner_user_id → users, and opportunity_id is a
 * plain reference to a CRM opportunity (no FK) so a bid can graduate into the
 * sales funnel without coupling the two schemas.
 *
 * Stages and compliance are text + CHECK, not pg enums — small vocabularies
 * that evolve.
 */
import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  doublePrecision,
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

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** BID-00001, from next_entry_number. */
    bidNumber: text("bid_number").notNull(),
    bidName: text("bid_name").notNull(),
    procuringEntity: text("procuring_entity").notNull().default(""),
    value: doublePrecision("value").notNull().default(0),
    /** Win probability, 0–100, driving the weighted pipeline figure. */
    winProbability: integer("win_probability").notNull().default(0),
    stage: text("stage").notNull().default("draft"),
    compliance: text("compliance").notNull().default("pending"),
    submissionDeadline: date("submission_deadline"),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    ownerName: text("owner_name").notNull().default(""),
    /** Soft link into CRM once a bid graduates into the funnel. */
    opportunityId: text("opportunity_id"),
    outcomeNote: text("outcome_note").notNull().default(""),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("bids_company_number_idx").on(t.companyId, t.bidNumber),
    index("bids_stage_idx").on(t.companyId, t.stage),
    index("bids_compliance_idx").on(t.companyId, t.compliance),
    index("bids_deadline_idx").on(t.companyId, t.submissionDeadline),
    check("bids_name_not_blank", sql`length(btrim(${t.bidName})) > 0`),
    check("bids_probability_range", sql`${t.winProbability} >= 0 AND ${t.winProbability} <= 100`),
    check(
      "bids_stage_valid",
      sql`${t.stage} IN ('draft','preparing','submitted','stage_2b','evaluation','awarded','lost','stopped')`,
    ),
    check(
      "bids_compliance_valid",
      sql`${t.compliance} IN ('pending','compliant','non_compliant')`,
    ),
  ],
);
