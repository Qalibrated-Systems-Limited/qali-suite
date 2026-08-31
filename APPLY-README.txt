TECHNICAL — dashboard + wider (less-scroll) forms
==================================================

Adds a Technical DASHBOARD (company-wide overview, modelled on the QSL app's
dashboard: status ring, reports-by-month, by-form-type) and spreads the report
forms across the full width in columns so they are far shorter — much less
scrolling. Also adds a "Dashboard" tab and a "Technical dashboard" sidebar link.

STEP 1 — extract into the project root (paste ONLY this line, no trailing text)
------------------------------------------------------------------------------
    unzip -o "/Users/zawadi/Downloads/technical-dashboard-update.zip" -d .

STEP 2 — DB
-----------
No NEW migration this round. If you already ran the previous update's
migration (0078, the `data` column), you can skip this. If unsure, run it —
it is a safe no-op when already applied:
    npm run db:migrate

STEP 3 — run (your dev server likely hot-reloads; restart only if needed)
-------------------------------------------------------------------------
    npm run dev

Then: Technical -> Dashboard (new tab) for the overview. Open New report ->
any sheet: the form now lays out in columns instead of one tall stack.

Notes:
- The dashboard is company-wide across all projects (RLS keeps it to your
  company). It reads the workflow_reports table only — no MongoDB.
- Every edit to a pre-existing ERP file is additive (verified vs a pristine
  copy). Nothing needs deleting.
