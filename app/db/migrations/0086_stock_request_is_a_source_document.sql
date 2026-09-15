-- ─────────────────────────────────────────────────────────────────────────────
-- 0086 — A stock request is a source document.
--
-- 0085 gave a project's consumed materials somewhere to post. This gives the
-- entry somewhere to point BACK to.
--
-- `journal_entries.source_type` names the document an entry came from, and the
-- goods issue against a stock request was not in the list — so the entry either
-- had no provenance at all, or had to claim to be a `stock_movement`, which is
-- the wrong document: one fulfilment issues several movements and posts ONE
-- entry, so a movement id could not identify it.
--
-- This enum is the PRODUCT'S vocabulary rather than a tenant's — the values are
-- the document types this system posts from, and adding one is a change to how
-- the software works. That is exactly when a migration is right, and it is the
-- distinction `project_types` (0082) is on the other side of.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "public"."source_document_type" ADD VALUE IF NOT EXISTS 'stock_request';
