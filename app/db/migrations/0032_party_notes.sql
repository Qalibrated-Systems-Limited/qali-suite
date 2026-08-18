-- ============================================================================
-- 0032 — Parties can carry a note.
--
-- Found wiring the parties form, which has always had a `notes` field and a
-- detail page that renders it. The column did not exist, so the port would
-- have accepted the field on the form and dropped it on the way to the
-- database — the quietest kind of data loss, because the form says it worked.
--
-- Free text about a customer or supplier: a delivery instruction, why the
-- credit limit is what it is, who to ask for. Nothing derives from it.
-- ============================================================================

ALTER TABLE "parties" ADD COLUMN "notes" text;
