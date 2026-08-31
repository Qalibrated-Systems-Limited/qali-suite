-- ─────────────────────────────────────────────────────────────────────────────
-- 0077 — Technical module: report type is a sheet CODE, not an enum.
--
-- 0076 shipped `workflow_reports.type` as the enum `workflow_report_type`
-- (progress/inspection/…). The Technical module replaces those five kinds with
-- the eight QSL sheet codes (WB01–WB06, SI01, TR01) and will keep adding sheets
-- from `app/dashboard/technical/lib/meta.js`, so the column becomes free text —
-- a catalogue that grows in code, not a type that grows by migration.
--
-- Existing rows keep whatever string they held; the enum type is dropped once
-- nothing references it. Touches only `workflow_reports`; no other table sees
-- this change.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "workflow_reports" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_reports" ALTER COLUMN "type" TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "workflow_reports" ALTER COLUMN "type" SET DEFAULT 'TR01';--> statement-breakpoint
DROP TYPE IF EXISTS "workflow_report_type";
