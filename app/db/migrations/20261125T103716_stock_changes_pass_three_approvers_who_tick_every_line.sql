-- ============================================================================
-- STOCK CHANGES PASS THREE APPROVERS, WHO TICK EVERY LINE
--
-- Stock added, adjusted, written off or corrected by a count used to need one
-- signature. It now passes a chain of steps (by default: store check,
-- operations review, finance approval). Each approver sees every line and
-- ticks each one to confirm it before approving their step; the change is
-- applied only when the last step approves.
--
--   * approval_requests.current_step / total_steps / current_step_roles —
--     where a request is in its chain, and who may act on it now. A request
--     with total_steps = 1 behaves exactly as before.
--   * approval_step_decisions — who approved which step, their note, and the
--     lines they confirmed. One row per step; the same person cannot sign two.
--   * approval_step_policies — a company's own chain for a type, edited in
--     Settings. No rows means the defaults in lib/business-rules.js.
--
-- SAFE TO APPLY because: new columns default to a one-step chain, so every
-- open request keeps its current behaviour; the new tables start empty.
-- ============================================================================

ALTER TABLE "approval_requests"
  ADD COLUMN "current_step" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "total_steps" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "current_step_label" text DEFAULT '' NOT NULL,
  ADD COLUMN "current_step_roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_step_in_range"
  CHECK ("total_steps" >= 1 AND "current_step" >= 1 AND "current_step" <= "total_steps");--> statement-breakpoint

CREATE TABLE "approval_step_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "approval_id" uuid NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "step_no" integer NOT NULL,
  "step_label" text NOT NULL,
  "decided_by_id" text NOT NULL,
  "decided_by_name" text NOT NULL,
  "decided_by_role" text,
  "note" text DEFAULT '' NOT NULL,
  "confirmed_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "approval_step_decisions_step_positive" CHECK ("step_no" >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX "approval_step_decisions_step_idx" ON "approval_step_decisions" ("approval_id", "step_no");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_step_decisions_one_signature_idx" ON "approval_step_decisions" ("approval_id", "decided_by_id");--> statement-breakpoint

CREATE TABLE "approval_step_policies" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "step_no" integer NOT NULL,
  "label" text NOT NULL,
  "roles" text[] NOT NULL,
  "updated_by_name" text DEFAULT 'System' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("company_id", "type", "step_no"),
  CONSTRAINT "approval_step_policies_step_range" CHECK ("step_no" BETWEEN 1 AND 5),
  CONSTRAINT "approval_step_policies_label_not_blank" CHECK (length(btrim("label")) > 0),
  CONSTRAINT "approval_step_policies_has_roles" CHECK (cardinality("roles") > 0)
);--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_step_decisions', 'approval_step_policies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT ON "approval_step_decisions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_step_policies" TO app_user;
