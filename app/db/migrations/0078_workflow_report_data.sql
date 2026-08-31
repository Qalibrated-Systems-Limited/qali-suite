-- ─────────────────────────────────────────────────────────────────────────────
-- 0078 — Technical module: the sheet body as JSON.
--
-- Each QSL sheet (WB01–WB06, SI01, TR01) has its own sections — checklists,
-- measurement fields, the End–Middle–End test, parts/calibration grids. Rather
-- than a column per field across eight forms, the answers live in one `data`
-- JSONB column whose shape the chosen sheet's template decides. A new sheet or
-- field then needs no migration. Touches only `workflow_reports`.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "workflow_reports"
  ADD COLUMN "data" jsonb NOT NULL DEFAULT '{}'::jsonb;
