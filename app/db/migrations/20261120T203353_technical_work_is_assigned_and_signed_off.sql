-- ============================================================================
-- TECHNICAL WORK IS ASSIGNED TO A PERSON, AND SIGNED OFF BY ANOTHER
--
-- A calibration job named its technician, and an inspection its inspector, as
-- free text. Nobody could be shown "my jobs", and the result a technician
-- recorded was final the moment it was typed: ISO/IEC 17025 (7.8) and 17020
-- (7.4) both expect a certificate or report to be authorised by someone other
-- than the person who did the work before it is issued.
--
-- Each job and inspection now:
--   * names the user who does the work (technician_id / inspector_id); the
--     name columns stay, so existing rows and printed documents still read;
--   * moves scheduled → in_progress → submitted → approved, with "returned"
--     sending it back to the technician with a comment;
--   * records who approved it and when. The approver cannot be the person who
--     did the work.
--
-- SAFE TO APPLY because: every new column is nullable or defaulted, existing
-- statuses stay valid ('completed' remains allowed and reads as done), and
-- inspections gain a status defaulted from their ruling.
-- ============================================================================

ALTER TABLE "calibration_jobs"
  ADD COLUMN "technician_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "submitted_at" timestamp with time zone,
  ADD COLUMN "approved_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "approved_by_name" text,
  ADD COLUMN "approved_at" timestamp with time zone,
  ADD COLUMN "return_comment" text DEFAULT '' NOT NULL;--> statement-breakpoint

ALTER TABLE "calibration_jobs" DROP CONSTRAINT "calibration_jobs_status_valid";--> statement-breakpoint
ALTER TABLE "calibration_jobs" ADD CONSTRAINT "calibration_jobs_status_valid"
  CHECK ("status" IN ('scheduled','in_progress','submitted','returned','approved','completed','cancelled'));--> statement-breakpoint
ALTER TABLE "calibration_jobs" ADD CONSTRAINT "calibration_jobs_approver_not_technician"
  CHECK ("approved_by_id" IS NULL OR "technician_id" IS NULL OR "approved_by_id" <> "technician_id");--> statement-breakpoint

ALTER TABLE "inspections"
  ADD COLUMN "inspector_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "status" text DEFAULT 'scheduled' NOT NULL,
  ADD COLUMN "submitted_at" timestamp with time zone,
  ADD COLUMN "approved_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "approved_by_name" text,
  ADD COLUMN "approved_at" timestamp with time zone,
  ADD COLUMN "return_comment" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- An inspection that already carries a ruling has been done.
UPDATE "inspections" SET "status" = 'completed' WHERE "ruling" <> 'pending';--> statement-breakpoint

ALTER TABLE "inspections" ADD CONSTRAINT "inspections_status_valid"
  CHECK ("status" IN ('scheduled','in_progress','submitted','returned','approved','completed','cancelled'));--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_approver_not_inspector"
  CHECK ("approved_by_id" IS NULL OR "inspector_id" IS NULL OR "approved_by_id" <> "inspector_id");--> statement-breakpoint

CREATE INDEX "calibration_jobs_technician_idx" ON "calibration_jobs" ("technician_id", "status");--> statement-breakpoint
CREATE INDEX "inspections_inspector_idx" ON "inspections" ("inspector_id", "status");
