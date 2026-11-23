-- ============================================================================
-- THE HELP DESK DOES WHAT A HELP DESK DOES
--
-- It logged, assigned and escalated tickets against a fixed SLA. What every
-- service desk also has, and this one lacked:
--
--   * ticket TYPES — an incident is not a service request, a question or a
--     problem, and they are counted and handled apart;
--   * SLA POLICIES the company sets per priority (the matrix was code), and
--     the clock PAUSED while a ticket waits on the customer ("pending");
--   * SAVED REPLIES for the answers given every day;
--   * a KNOWLEDGE BASE, and the article that solved a ticket recorded on it;
--   * MERGING a duplicate into the ticket that carries the work;
--   * the requester's SATISFACTION rating once it is resolved;
--   * a DEFAULT ASSIGNEE per category, so a ticket lands with someone.
--
-- SAFE TO APPLY because: new columns are nullable or defaulted ('incident'
-- for the type every existing ticket was), new tables are empty, and the SLA
-- policy table falls back to the code's matrix when a priority has no row.
-- ============================================================================

ALTER TABLE "helpdesk_tickets"
  ADD COLUMN "ticket_type" text DEFAULT 'incident' NOT NULL,
  ADD COLUMN "sla_paused_at" timestamp with time zone,
  ADD COLUMN "merged_into_id" uuid REFERENCES "helpdesk_tickets"("id") ON DELETE SET NULL,
  ADD COLUMN "satisfaction_rating" smallint,
  ADD COLUMN "satisfaction_comment" text DEFAULT '' NOT NULL,
  ADD COLUMN "rated_at" timestamp with time zone,
  ADD COLUMN "solution_article_id" uuid;--> statement-breakpoint

ALTER TABLE "helpdesk_tickets"
  ADD CONSTRAINT "helpdesk_tickets_type_valid" CHECK ("ticket_type" IN ('incident','service_request','question','problem','complaint')),
  ADD CONSTRAINT "helpdesk_tickets_rating_valid" CHECK ("satisfaction_rating" IS NULL OR "satisfaction_rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "helpdesk_tickets_not_merged_into_itself" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");--> statement-breakpoint

ALTER TABLE "helpdesk_categories"
  ADD COLUMN "default_assignee_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "default_assignee_name" text DEFAULT '' NOT NULL;--> statement-breakpoint

CREATE TABLE "helpdesk_sla_policies" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "priority" text NOT NULL,
  "response_hours" numeric(6,2) NOT NULL,
  "resolution_hours" numeric(6,2) NOT NULL,
  "updated_by_name" text DEFAULT 'System' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("company_id", "priority"),
  CONSTRAINT "helpdesk_sla_priority_valid" CHECK ("priority" IN ('low','medium','high','critical')),
  CONSTRAINT "helpdesk_sla_hours_positive" CHECK ("response_hours" > 0 AND "resolution_hours" >= "response_hours")
);--> statement-breakpoint

CREATE TABLE "helpdesk_canned_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "created_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "helpdesk_canned_title_not_blank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "helpdesk_canned_body_not_blank" CHECK (length(btrim("body")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "helpdesk_canned_company_title_idx" ON "helpdesk_canned_responses" ("company_id", lower("title"));--> statement-breakpoint

CREATE TABLE "helpdesk_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "article_number" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "category_id" uuid REFERENCES "helpdesk_categories"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'published' NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "helpful" integer DEFAULT 0 NOT NULL,
  "created_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "helpdesk_articles_title_not_blank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "helpdesk_articles_status_valid" CHECK ("status" IN ('draft','published','archived'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "helpdesk_articles_company_number_idx" ON "helpdesk_articles" ("company_id", "article_number");--> statement-breakpoint

ALTER TABLE "helpdesk_tickets"
  ADD CONSTRAINT "helpdesk_tickets_solution_article_fk"
  FOREIGN KEY ("solution_article_id") REFERENCES "helpdesk_articles"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "helpdesk_tickets_requester_idx" ON "helpdesk_tickets" ("company_id", "created_by_id", "status");--> statement-breakpoint
CREATE INDEX "helpdesk_tickets_resolved_idx" ON "helpdesk_tickets" ("status", "resolved_at") WHERE "status" = 'resolved';--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['helpdesk_sla_policies', 'helpdesk_canned_responses', 'helpdesk_articles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "helpdesk_sla_policies" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "helpdesk_canned_responses" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "helpdesk_articles" TO app_user;
