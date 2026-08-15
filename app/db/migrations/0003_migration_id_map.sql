-- ============================================================================
-- 0003 — ObjectId -> UUID mapping.
--
-- Mongo ObjectIds are 12 bytes, UUIDs are 16. They are not convertible, so the
-- backfill runs in two passes: pass 1 allocates a UUID for every source
-- document and records it here; pass 2 resolves every foreign key through this
-- table.
--
-- Retained after cutover deliberately. It is the only way to trace a
-- post-migration record back to the Mongo document a support ticket refers to,
-- and the only way to re-run a failed backfill idempotently.
-- ============================================================================

CREATE TABLE "_migration_id_map" (
  "collection"     text NOT NULL,
  "old_object_id"  text NOT NULL,
  "new_uuid"       uuid NOT NULL,
  "migrated_at"    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("collection", "old_object_id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "_migration_id_map_uuid_uq" ON "_migration_id_map" ("new_uuid");
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Quarantine for source documents the target refuses to accept.
--
-- The expected case is a journal entry whose float debits and credits do not
-- sum equal. Those must NOT be silently rounded into balance — each one is an
-- accounting discrepancy that predates the migration and needs a decision.
-- The backfill records them here and continues, so one bad entry does not
-- abort a run of thousands.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "_migration_rejects" (
  "id"            bigserial PRIMARY KEY,
  "collection"    text NOT NULL,
  "old_object_id" text NOT NULL,
  "reason"        text NOT NULL,
  "detail"        jsonb,
  "rejected_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "_migration_rejects_collection_idx" ON "_migration_rejects" ("collection");
