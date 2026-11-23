-- ============================================================================
-- TECHNICAL RESOURCES ARE REQUESTED, AND THE TECHNICAL MANAGER APPROVES THEM
--
-- A help desk agent, a project manager or a contracts lead could put a
-- technician on their work directly, and nobody responsible for the technical
-- team saw it until the technician was double-booked, on leave, or already
-- carrying more than they could do. Vehicles and test equipment were the same.
--
-- Now a technician, a vehicle or a piece of equipment is REQUESTED for a piece
-- of work and a period; the technical manager sees whether it is free (leave,
-- other bookings, open work, a reference standard's calibration date) and
-- approves or rejects it. Approving applies it: the ticket, job, inspection or
-- project task is assigned. Rejecting says why.
--
-- `resource_id` is text because a technician is a user (text id), and a
-- vehicle or a standard a uuid; the kind says which.
--
-- SAFE TO APPLY because: a new table; nothing existing reads or changes.
-- ============================================================================

CREATE TABLE "resource_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "request_number" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "resource_name" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "source_ref" text DEFAULT '' NOT NULL,
  "source_title" text DEFAULT '' NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_by_name" text,
  "decided_at" timestamp with time zone,
  "decision_note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resource_requests_type_valid" CHECK ("resource_type" IN ('technician','vehicle','equipment')),
  CONSTRAINT "resource_requests_source_valid" CHECK ("source_type" IN ('ticket','project_task','project','contract','calibration_job','inspection','other')),
  CONSTRAINT "resource_requests_status_valid" CHECK ("status" IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT "resource_requests_dates_valid" CHECK ("end_date" >= "start_date"),
  CONSTRAINT "resource_requests_decided" CHECK (
    "status" IN ('pending','cancelled') OR ("decided_at" IS NOT NULL AND "decided_by_name" IS NOT NULL)
  ),
  CONSTRAINT "resource_requests_rejection_explained" CHECK (
    "status" <> 'rejected' OR length(btrim("decision_note")) > 0
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "resource_requests_company_number_idx" ON "resource_requests" ("company_id", "request_number");--> statement-breakpoint
CREATE INDEX "resource_requests_queue_idx" ON "resource_requests" ("company_id", "status", "start_date");--> statement-breakpoint
CREATE INDEX "resource_requests_resource_idx" ON "resource_requests" ("company_id", "resource_type", "resource_id", "start_date", "end_date");--> statement-breakpoint

ALTER TABLE "resource_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resource_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "resource_requests"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

-- A request is a record of who asked and who decided: never deleted, cancelled.
GRANT SELECT, INSERT, UPDATE ON "resource_requests" TO app_user;
