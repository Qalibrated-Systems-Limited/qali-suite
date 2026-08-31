TECHNICAL — Calibration & Inspection rebuilt (real, DB-backed) + form fix
========================================================================

WHAT'S IN THIS UPDATE
- Calibration (17025) and Inspection (17020) are now REAL pages (were dummy
  demos): real tables, tabs, filters, KPI tiles, and working create forms
  (New Cal Job, New Reference Standard, New Inspection), all saving to Postgres.
  Row actions let you advance status/result/billing and rulings/appeals inline.
- Report-form fix: the checklist now spans full width, so a short field (e.g.
  "Anything else you saw today") no longer sits beside a tall checklist leaving
  blank space.

STEP 1 — extract into the project root (paste ONLY this line)
    unzip -o "/Users/zawadi/Downloads/technical-calibration-inspection.zip" -d .

STEP 2 — DB migration (adds 3 tables: calibration_jobs, calibration_standards,
inspections). Paste ONLY this line:
    npm run db:migrate

STEP 3 — run / refresh
    npm run dev
  Then open Technical -> Calibration (17025) and Inspection (17020).
  Click "+ New Cal Job" / "+ New Inspection" to create records; they appear in
  the tables and drive the KPI tiles.

NOTES
- These two pages were DELIBERATELY rebuilt (they replaced the dummy-data demo
  files). Every other pre-existing ERP file touched (schema/index, journal,
  role-gates) is additive only.
- The new tables are company-scoped with the same row-level security as every
  other table. No MongoDB. No new npm packages.
