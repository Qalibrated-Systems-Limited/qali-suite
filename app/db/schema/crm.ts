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
import { parties } from "./parties";
import {
  leadSourceEnum,
  leadStatusEnum,
  leadRatingEnum,
  opportunityStageEnum,
  opportunityLostReasonEnum,
  crmActivityTypeEnum,
  crmActivityTargetEnum,
  crmActivityDirectionEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * The funnel before the quote — 0096.
 *
 * `docs/CURRENT-STATE.md` names this as a whole missing module: "CRM / Lead
 * pipeline — First touch is the Quote — nothing tracks the funnel before that."
 *
 * A LEAD IS DELIBERATELY NOT A PARTY. It is an unqualified prospect: a name
 * with a flicker of interest, no credit terms and no balance. `company_name`
 * is FREE TEXT, and putting tyre-kickers in `parties` would corrupt AR aging
 * and every customer count in the system. It becomes a party on conversion,
 * and `converted_party_id` records that it did.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** LEAD-00001, from `next_entry_number`. */
    leadNumber: text("lead_number").notNull(),

    name: text("name").notNull(),
    /** Free text. This is not a party yet — that is the whole point. */
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),

    source: leadSourceEnum("source").notNull().default("other"),
    rating: leadRatingEnum("rating"),
    status: leadStatusEnum("status").notNull().default("new"),

    estimatedValue: money("estimated_value").notNull().default("0"),

    /** Snapshot id and name, so "my leads" never needs a join. */
    ownerUserId: text("owner_user_id"),
    ownerName: text("owner_name"),
    ownerRole: text("owner_role"),

    notes: text("notes").notNull().default(""),
    lostReason: text("lost_reason"),

    convertedPartyId: uuid("converted_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    /**
     * The FK to `opportunities` is in the DDL only — declaring it here would
     * make this module and itself circular through the table defined below.
     */
    convertedOpportunityId: uuid("converted_opportunity_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_number_uq").on(t.companyId, t.leadNumber),
    index("leads_queue_idx").on(t.companyId, t.status, t.createdAt.desc()),
    index("leads_owner_idx").on(t.companyId, t.ownerUserId, t.status),

    check("leads_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("leads_estimated_value_non_negative", sql`${t.estimatedValue} >= 0`),
    /** Converted means a date, and a date means converted. */
    check(
      "leads_conversion_pair",
      sql`(${t.status} = 'converted') = (${t.convertedAt} IS NOT NULL)`,
    ),
    /** And a conversion produced a party — the account is the point of it. */
    check(
      "leads_conversion_made_a_party",
      sql`${t.convertedAt} IS NULL OR ${t.convertedPartyId} IS NOT NULL`,
    ),
  ],
);

/**
 * A qualified, trackable deal — the unit of the pipeline.
 *
 * PROBABILITY IS NULLABLE, AND THAT IS A FIX. Mongo seeded it from the stage
 * in a pre-save hook that fired only when it was null, so once seeded it never
 * moved again: a deal created at qualification and advanced to negotiation
 * still forecast at 10%. Here NULL means "follow the stage" and the effective
 * value is computed on read, so an un-overridden deal tracks its stage and an
 * override sticks.
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    opportunityNumber: text("opportunity_number").notNull(),

    name: text("name").notNull(),

    /** A real party, unlike a lead. The name is snapshot beside it. */
    accountPartyId: uuid("account_party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    accountName: text("account_name").notNull(),

    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),

    ownerUserId: text("owner_user_id"),
    ownerName: text("owner_name"),
    ownerRole: text("owner_role"),

    stage: opportunityStageEnum("stage").notNull().default("qualification"),
    amount: money("amount").notNull().default("0"),
    currency: text("currency").notNull().default("KES"),
    probability: integer("probability"),
    expectedCloseDate: date("expected_close_date"),
    source: text("source"),

    /** Provenance, when a lead conversion spawned it. */
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    leadNumber: text("lead_number"),

    lostReason: opportunityLostReasonEnum("lost_reason"),
    lostNote: text("lost_note"),

    wonQuoteId: uuid("won_quote_id"),
    wonInvoiceId: uuid("won_invoice_id"),
    wonAt: timestamp("won_at", { withTimezone: true }),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunities_number_uq").on(t.companyId, t.opportunityNumber),
    index("opportunities_pipeline_idx").on(t.companyId, t.stage, t.expectedCloseDate),
    index("opportunities_owner_idx").on(t.companyId, t.ownerUserId, t.stage),
    index("opportunities_account_idx").on(t.companyId, t.accountPartyId),

    check("opportunities_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("opportunities_account_named", sql`length(btrim(${t.accountName})) > 0`),
    check("opportunities_amount_non_negative", sql`${t.amount} >= 0`),
    check(
      "opportunities_probability_in_range",
      sql`${t.probability} IS NULL OR (${t.probability} >= 0 AND ${t.probability} <= 100)`,
    ),
    /**
     * Mongo left both free, so a deal could carry a lost reason into
     * negotiation and a won date while still open.
     */
    check(
      "opportunities_lost_reason_is_lost",
      sql`${t.lostReason} IS NULL OR ${t.stage} = 'closed_lost'`,
    ),
    check(
      "opportunities_won_at_is_won",
      sql`${t.wonAt} IS NULL OR ${t.stage} = 'closed_won'`,
    ),
  ],
);

/**
 * Every stage transition, for velocity — how long a deal sits in each stage,
 * which is the most actionable pipeline metric there is.
 *
 * WRITTEN BY `opportunities_record_stage`, not by the repository. The Mongo
 * hook only fired on `save()`, so any update taking another path left the
 * trail short. A trigger cannot be skipped.
 */
export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    stage: opportunityStageEnum("stage").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    byId: text("by_id"),
    byName: text("by_name"),
  },
  (t) => [index("opportunity_stage_history_idx").on(t.opportunityId, t.at)],
);

/**
 * The activity trail.
 *
 * `targetId` CARRIES NO FOREIGN KEY, and that is stated rather than papered
 * over: an activity attaches to a lead, an opportunity, a party, a contact, an
 * invoice or a quote, and six targets make one key impossible. Nothing stops
 * an activity pointing at a deleted row, so readers must tolerate it.
 */
export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    type: crmActivityTypeEnum("type").notNull(),
    targetType: crmActivityTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),

    subject: text("subject"),
    body: text("body"),
    direction: crmActivityDirectionEnum("direction").notNull().default("none"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    byId: text("by_id"),
    byName: text("by_name"),
    byRole: text("by_role"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("crm_activities_target_idx").on(
      t.companyId,
      t.targetType,
      t.targetId,
      t.occurredAt.desc(),
    ),
  ],
);
