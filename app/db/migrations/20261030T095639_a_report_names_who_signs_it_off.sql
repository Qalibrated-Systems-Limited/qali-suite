-- ============================================================================
-- A REPORT NAMES WHO SIGNS IT OFF
--
-- A submitted technical report could be given "Supervisor sign-off" by anyone
-- in the sign-off group, and then "Manager approval" by the same person — the
-- review chose nobody, and two signatures could be one pair of hands.
--
-- The submitter now names the supervisor and the approving manager. Only the
-- named person can sign their step (reassignable by the sign-off group when
-- someone is away), the supervisor cannot be the submitter, and the approver
-- cannot be the supervisor.
--
-- SAFE TO APPLY because: every column is nullable and nothing reads them yet.
-- Reports already submitted keep working: an unassigned step is open to the
-- sign-off group, as before.
-- ============================================================================

ALTER TABLE "workflow_reports"
  ADD COLUMN "submitted_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "assigned_reviewer_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "assigned_reviewer_name" text,
  ADD COLUMN "assigned_approver_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "assigned_approver_name" text;--> statement-breakpoint

ALTER TABLE "workflow_reports"
  ADD CONSTRAINT "workflow_reports_reviewer_not_approver" CHECK (
    "assigned_reviewer_id" IS NULL OR "assigned_approver_id" IS NULL
    OR "assigned_reviewer_id" <> "assigned_approver_id"
  );--> statement-breakpoint

CREATE INDEX "workflow_reports_reviewer_queue_idx"
  ON "workflow_reports" ("assigned_reviewer_id") WHERE "status" = 'submitted';--> statement-breakpoint
CREATE INDEX "workflow_reports_approver_queue_idx"
  ON "workflow_reports" ("assigned_approver_id") WHERE "status" = 'reviewed';
