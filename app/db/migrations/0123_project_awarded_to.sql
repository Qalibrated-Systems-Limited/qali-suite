-- 0123 — "Company the work is awarded to" on the project data sheet.
--
-- The QSL Project Control data sheet names the group entity holding the
-- contract, distinct from the client. Nullable text, like the rest of the sheet.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "awarded_to_company" text;
