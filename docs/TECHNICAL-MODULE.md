# Technical — ERP module (0076 / 0077)

The standalone QSL field-service reporting app, brought into QaliSuite as the
**Technical** module. It wears the QSL "Qalibrated Systems" skin — the coal/gold
striped bar, gold actions, angular status cards — while reading the ERP's own
light / dark(-blue) theme tokens, so the whole module flips with the ERP theme
toggle. It feeds from the ERP Projects module: every report is raised against a
project and snapshots the project's live figures when submitted.

## Screens (route `/dashboard/technical`)

- **Report registry** (`/dashboard/technical`) — browse-by-status folders
  (All / Drafts / In review / Approved), search, and the angular QSL status
  cards. Project switcher in the header.
- **Choose the sheet** (`/dashboard/technical/new`) — the eight QSL sheets
  (WB01–WB06, SI01, TR01) as pick-tiles, matching the standalone app.
- **New report** (`/dashboard/technical/create?sheet=WB01`) — the sheet form.
- **Report** (`/dashboard/technical/[id]`) — narrative, project snapshot,
  review trail and the workflow bar.

## Sheets

The eight sheets live in `app/dashboard/technical/lib/meta.js` — the single
source of truth. Each report stores its sheet **code** in `workflow_reports.type`
(free text, not an enum), and is serialised per sheet: `QSL-WB01-00001`. Add or
rename a sheet by editing `meta.js`; no migration needed.

## Review workflow

`draft → submitted → reviewed → approved` (with reopen), labelled in the UI as
Draft → Supervisor review → Manager approval → Approved. Each forward step
stamps a name + timestamp (enforced by CHECK constraints). Authority reuses the
Projects role tiers: `WORKFLOW_REPORT_WRITE_ROLES` drafts/edits/submits,
`WORKFLOW_REPORT_SIGNOFF_ROLES` reviews/approves/reopens.

## Theme

`app/dashboard/technical/technical.css` is scoped under `.tech`. Surfaces come
from the ERP tokens (`var(--card)`, `var(--foreground)`, `var(--border)`, …) so
they follow the ERP light/dark; only the QSL brand marks are fixed colours that
read on both themes. Layout is deliberately wide and dense to close white space.

## Database

- `workflow_reports` table (0076), tenant-RLS'd like every company-scoped table.
- 0077 converts `type` from the 0076 enum to text (the sheet code).
- Apply both with `npm run db:migrate`. Touches only `workflow_reports`.
