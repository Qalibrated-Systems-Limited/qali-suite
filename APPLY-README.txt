PROJECTS — Programme Gantt + spreadsheet upload
===============================================

WHAT'S IN THIS UPDATE
- Projects -> Programme is restyled as a QaliTrack-style Gantt: sections as
  grouped header rows, phase-coloured bars with a % fill, a sticky Activity
  column, a month header, and a Start / Target end / Duration / Activities
  strip.
- New "Import programme" button: upload a .csv or .xlsx and it builds the
  project's tasks for you (one section per Section, one task per Activity).

NO migration, NO new npm packages (parsing reuses the installed exceljs).

STEP 1 — extract into the project root (paste ONLY this line)
    unzip -o "/Users/zawadi/Downloads/programme-gantt-upload.zip" -d .

STEP 2 — run / refresh
    npm run dev
  Then: Projects -> pick a project -> Programme -> "Import programme".

THE SPREADSHEET FORMAT
  Columns (a header row is detected automatically; order can vary if headers
  are present, otherwise put them in this order):
      Section | Activity | Start | End | %
  - Start / End accept 2026-04-01, 01/04/2026, or real Excel date cells.
  - % is 0..100 (blank = 0).
  - A blank Section carries the previous one forward (so you only write the
    phase name on its first row).
  There is a "Download template" link inside the import dialog.

FILES (all new or the rebuilt Programme page):
  app/db/actions/programme-actions.js            (server-side file parser + import)
  app/dashboard/projects/components/ImportProgramme.jsx
  app/dashboard/projects/programme/page.jsx      (the restyled Gantt)
