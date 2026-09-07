-- ─────────────────────────────────────────────────────────────────────────────
-- 0089 — Help Desk (Ticketing).
--
-- The core help-desk spine ported from the Lante ERP Ticketing microservice:
-- categories, tickets (carrying their own SLA response/resolution clocks),
-- threaded comments and an append-only history. Company-scoped, RLS'd and
-- granted the same as every table since 0001; ticket numbers come from
-- next_entry_number('TKT'). Touches nothing outside these four new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "helpdesk_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"default_priority" text DEFAULT 'medium' NOT NULL,
	"requires_evidence" boolean DEFAULT false NOT NULL,
	"is_complaint" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helpdesk_categories_name_not_blank" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "helpdesk_categories_priority_valid" CHECK ("default_priority" IN ('low','medium','high','critical'))
);
--> statement-breakpoint

CREATE TABLE "helpdesk_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"category_name" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"requester_name" text DEFAULT '' NOT NULL,
	"requester_email" text DEFAULT '' NOT NULL,
	"assigned_to_user_id" text,
	"assignee_name" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"due_date" date,
	"response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution_notes" text DEFAULT '' NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"escalation_level" text,
	"closure_reason" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helpdesk_tickets_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "helpdesk_tickets_priority_valid" CHECK ("priority" IN ('low','medium','high','critical')),
	CONSTRAINT "helpdesk_tickets_status_valid" CHECK ("status" IN ('new','assigned','in_progress','pending','escalated','resolved','closed','reopened')),
	CONSTRAINT "helpdesk_tickets_source_valid" CHECK ("source" IN ('manual','system','crm','safety','scheduled'))
);
--> statement-breakpoint

CREATE TABLE "helpdesk_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" text,
	"author_name" text DEFAULT 'Unknown' NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helpdesk_comments_content_not_blank" CHECK (length(btrim("content")) > 0)
);
--> statement-breakpoint

CREATE TABLE "helpdesk_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" text,
	"user_name" text DEFAULT 'System' NOT NULL,
	"action" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_category_id_helpdesk_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."helpdesk_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "helpdesk_comments" ADD CONSTRAINT "helpdesk_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_comments" ADD CONSTRAINT "helpdesk_comments_ticket_id_helpdesk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."helpdesk_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_comments" ADD CONSTRAINT "helpdesk_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "helpdesk_history" ADD CONSTRAINT "helpdesk_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_history" ADD CONSTRAINT "helpdesk_history_ticket_id_helpdesk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."helpdesk_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_history" ADD CONSTRAINT "helpdesk_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "helpdesk_categories_company_name_idx" ON "helpdesk_categories" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "helpdesk_tickets_company_number_idx" ON "helpdesk_tickets" USING btree ("company_id","ticket_number");--> statement-breakpoint
CREATE INDEX "helpdesk_tickets_status_idx" ON "helpdesk_tickets" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "helpdesk_tickets_priority_idx" ON "helpdesk_tickets" USING btree ("company_id","priority");--> statement-breakpoint
CREATE INDEX "helpdesk_tickets_assignee_idx" ON "helpdesk_tickets" USING btree ("company_id","assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "helpdesk_comments_ticket_idx" ON "helpdesk_comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "helpdesk_history_ticket_idx" ON "helpdesk_history" USING btree ("ticket_id","occurred_at");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['helpdesk_categories','helpdesk_tickets','helpdesk_comments','helpdesk_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
