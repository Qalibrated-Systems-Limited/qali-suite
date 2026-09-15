-- ─────────────────────────────────────────────────────────────────────────────
-- 0096 — The funnel before the quote.
--
-- `docs/CURRENT-STATE.md` names this as a whole missing module: "CRM / Lead
-- pipeline ⬜ — First touch is the Quote — nothing tracks the funnel before
-- that." Three Mongo models, ~1,166 lines of queries and actions, and nine
-- screens that cannot move until the tables exist.
--
-- Porting it closes leads (4), opportunities (3), the executive overview's
-- last Mongo read (1) and the CRM activity composer (1). The executive one has
-- been called out in the handoffs as "NOT WORK — the CRM genuinely is still on
-- Mongo, so that read is correct until opportunities port". This is that.
--
-- ── Decision 1 — A LEAD IS DELIBERATELY NOT A PARTY ───────────────────────
--
-- The Mongo model's own reasoning, and it is right: a lead is an UNQUALIFIED
-- prospect — a name with a flicker of interest. It has no credit terms and no
-- balance, and putting tyre-kickers in `parties` would corrupt AR aging and
-- every customer count in the system.
--
-- `company_name` is therefore FREE TEXT. It becomes a party only on
-- conversion, and `converted_party_id` records that it did.
--
-- ── Decision 2 — PROBABILITY IS NULLABLE, AND THAT FIXES A BUG ────────────
--
-- Mongo seeds `probability` from the stage in a pre-save hook, but only when
-- it is null — so once seeded it NEVER MOVES AGAIN. A deal created at
-- qualification (10%) and advanced to negotiation still forecasts at 10%, and
-- the weighted pipeline on the board is wrong for every deal anybody has ever
-- advanced. That is most of them.
--
-- Here the column stays NULL unless somebody overrides it, and the effective
-- probability is COALESCE(probability, the stage's default) computed on read.
-- A deal with no override tracks its stage; an override sticks. Which is what
-- "defaults from the stage but can be overridden" was supposed to mean.
--
-- ── Decision 3 — STAGE HISTORY IS A TABLE, WRITTEN BY THE DATABASE ────────
--
-- Mongo keeps it as an embedded array appended by the same pre-save hook, and
-- the detail page renders it as a timeline — so it is read, not dead. As a
-- table it is append-only and a trigger writes it, which means no write path
-- can skip it. The hook could be, and was: any update that did not go through
-- `save()` left the history short.
--
-- It is NOT folded into `crm_activities` even though that has a `stage_change`
-- type. Velocity — how long a deal sits in each stage — is the most actionable
-- pipeline metric there is, and it should not depend on an activity log that
-- people delete rows from.
--
-- ── Decision 4 — THE ACTIVITY TARGET IS POLYMORPHIC AND HAS NO KEY ────────
--
-- An activity attaches to a lead, an opportunity, a party, a contact, an
-- invoice or a quote. Six targets, so `target_id` CANNOT carry a foreign key,
-- and this is stated rather than papered over: nothing stops an activity
-- pointing at a row that has been deleted, and readers must tolerate it.
--
-- The alternative — six nullable columns with a check that exactly one is set
-- — buys referential integrity and costs a column per future target. Mongo
-- chose the loose shape and every screen reads it that way; changing it would
-- be a rewrite of the read side for a guarantee no screen currently needs.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "lead_source" AS ENUM ('website', 'referral', 'walk_in', 'campaign', 'cold_call', 'trade_show', 'social', 'other');--> statement-breakpoint
CREATE TYPE "lead_status" AS ENUM ('new', 'contacted', 'qualified', 'unqualified', 'converted');--> statement-breakpoint
CREATE TYPE "lead_rating" AS ENUM ('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "opportunity_stage" AS ENUM ('qualification', 'needs_analysis', 'proposal', 'negotiation', 'closed_won', 'closed_lost');--> statement-breakpoint
CREATE TYPE "opportunity_lost_reason" AS ENUM ('price', 'competitor', 'timing', 'no_budget', 'no_decision', 'other');--> statement-breakpoint
CREATE TYPE "crm_activity_type" AS ENUM ('note', 'call', 'email', 'meeting', 'whatsapp', 'sms', 'stage_change', 'conversion', 'system');--> statement-breakpoint
CREATE TYPE "crm_activity_target" AS ENUM ('lead', 'opportunity', 'party', 'contact', 'invoice', 'quote');--> statement-breakpoint
CREATE TYPE "crm_activity_direction" AS ENUM ('inbound', 'outbound', 'none');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- LEADS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "lead_number" text NOT NULL,

  "name" text NOT NULL,
  -- FREE TEXT, and decision 1 is why: this is not a party yet.
  "company_name" text,
  "job_title" text,
  "email" text,
  "phone" text,

  "source" "lead_source" DEFAULT 'other' NOT NULL,
  "rating" "lead_rating",
  "status" "lead_status" DEFAULT 'new' NOT NULL,

  "estimated_value" numeric(19, 4) DEFAULT '0' NOT NULL,

  -- Snapshot id and name, as every owner in this codebase is, so "my leads"
  -- never needs a join.
  "owner_user_id" text,
  "owner_name" text,
  "owner_role" text,

  "notes" text DEFAULT '' NOT NULL,
  "lost_reason" text,

  "converted_party_id" uuid,
  "converted_opportunity_id" uuid,
  "converted_at" timestamp with time zone,

  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "leads_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "leads_estimated_value_non_negative" CHECK ("estimated_value" >= 0),
  -- Converted means a date, and a date means converted.
  CONSTRAINT "leads_conversion_pair"
    CHECK (("status" = 'converted') = ("converted_at" IS NOT NULL)),
  -- And a conversion produced a party. An opportunity is optional — a lead can
  -- graduate into an account without a live deal — but the account is the point.
  CONSTRAINT "leads_conversion_made_a_party"
    CHECK ("converted_at" IS NULL OR "converted_party_id" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_party_id_parties_id_fk" FOREIGN KEY ("converted_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "leads_number_uq" ON "leads" USING btree ("company_id","lead_number");--> statement-breakpoint
CREATE INDEX "leads_queue_idx" ON "leads" USING btree ("company_id","status","created_at" DESC);--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("company_id","owner_user_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- OPPORTUNITIES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "opportunity_number" text NOT NULL,

  "name" text NOT NULL,

  -- A real party, unlike a lead. The name is snapshot beside it so a pipeline
  -- board renders without a join.
  "account_party_id" uuid NOT NULL,
  "account_name" text NOT NULL,

  "contact_name" text,
  "contact_email" text,
  "contact_phone" text,

  "owner_user_id" text,
  "owner_name" text,
  "owner_role" text,

  "stage" "opportunity_stage" DEFAULT 'qualification' NOT NULL,
  "amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "currency" text DEFAULT 'KES' NOT NULL,
  -- Decision 2: NULL means "follow the stage", and that is the common case.
  "probability" integer,
  "expected_close_date" date,
  "source" text,

  -- Provenance, when a lead conversion spawned it.
  "lead_id" uuid,
  "lead_number" text,

  "lost_reason" "opportunity_lost_reason",
  "lost_note" text,

  "won_quote_id" uuid,
  "won_invoice_id" uuid,
  "won_at" timestamp with time zone,

  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "opportunities_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "opportunities_account_named" CHECK (length(btrim("account_name")) > 0),
  CONSTRAINT "opportunities_amount_non_negative" CHECK ("amount" >= 0),
  CONSTRAINT "opportunities_probability_in_range"
    CHECK ("probability" IS NULL OR ("probability" >= 0 AND "probability" <= 100)),

  -- A reason for losing belongs to a lost deal, and a won date to a won one.
  -- Mongo left both free, so a deal could carry a lost_reason into negotiation
  -- and a won_at while still open.
  CONSTRAINT "opportunities_lost_reason_is_lost"
    CHECK ("lost_reason" IS NULL OR "stage" = 'closed_lost'),
  CONSTRAINT "opportunities_won_at_is_won"
    CHECK ("won_at" IS NULL OR "stage" = 'closed_won')
);--> statement-breakpoint

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_party_id_parties_id_fk" FOREIGN KEY ("account_party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- `set null`: deleting a lead must not delete the deal it became.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The lead's side of the same link, added now that `opportunities` exists.
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_opportunity_id_opportunities_id_fk" FOREIGN KEY ("converted_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "opportunities_number_uq" ON "opportunities" USING btree ("company_id","opportunity_number");--> statement-breakpoint
CREATE INDEX "opportunities_pipeline_idx" ON "opportunities" USING btree ("company_id","stage","expected_close_date");--> statement-breakpoint
CREATE INDEX "opportunities_owner_idx" ON "opportunities" USING btree ("company_id","owner_user_id","stage");--> statement-breakpoint
CREATE INDEX "opportunities_account_idx" ON "opportunities" USING btree ("company_id","account_party_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- STAGE HISTORY — decision 3, and the database writes it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "opportunity_stage_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "stage" "opportunity_stage" NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "by_id" text,
  "by_name" text
);--> statement-breakpoint

ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "opportunity_stage_history_idx" ON "opportunity_stage_history" USING btree ("opportunity_id","at");--> statement-breakpoint

-- Appended on create and on every stage change, by the database — so no write
-- path can leave the history short, which the Mongo pre-save hook could and
-- did for any update that did not go through `save()`.
CREATE OR REPLACE FUNCTION opportunities_record_stage() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO opportunity_stage_history (company_id, opportunity_id, stage, by_id, by_name)
    VALUES (
      NEW.company_id, NEW.id, NEW.stage,
      COALESCE(NEW.last_modified_by_id, NEW.created_by_id),
      COALESCE(NEW.last_modified_by_name, NEW.created_by_name)
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "opportunities_record_stage"
AFTER INSERT OR UPDATE OF stage ON "opportunities"
FOR EACH ROW EXECUTE FUNCTION opportunities_record_stage();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- ACTIVITIES — decision 4: six targets, so no foreign key on `target_id`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "crm_activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,

  "type" "crm_activity_type" NOT NULL,
  "target_type" "crm_activity_target" NOT NULL,
  -- Deliberately unkeyed. Nothing stops this pointing at a deleted row, and
  -- readers must tolerate it.
  "target_id" uuid NOT NULL,

  "subject" text,
  "body" text,
  "direction" "crm_activity_direction" DEFAULT 'none' NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,

  "by_id" text,
  "by_name" text,
  "by_role" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- The only query the timeline makes: this thing, newest first.
CREATE INDEX "crm_activities_target_idx" ON "crm_activities" USING btree ("company_id","target_type","target_id","occurred_at" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'opportunities', 'opportunity_stage_history',
                           'crm_activities'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "leads" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "opportunities" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "opportunity_stage_history" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "crm_activities" TO app_user;
