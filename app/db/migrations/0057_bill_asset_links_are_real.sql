-- ============================================================================
-- 0057 — The bill-to-asset links become foreign keys.
--
-- 0053 typed `bill_lines.asset_id` and `bill_lines.capitalized_asset_id` as
-- text because assets were on Mongo and their ids were ObjectIds, and wrote
-- down the deal:
--
--     "When projects and assets land in Postgres these become uuid and gain
--      their foreign keys, in the migration that ports them."
--
-- Assets landed in 0056. This is that migration.
--
-- `asset_id` is the tag put on a bill line so fuel, servicing and repairs can
-- be attributed to the vehicle they were for. `capitalized_asset_id` is set
-- once a line has been turned into a register entry, and is what stops the
-- same spend being capitalised twice.
--
-- Both are ON DELETE SET NULL rather than RESTRICT: an asset that is deleted
-- outright — which only happens before anything posts — should not lock the
-- bill it came from. The register entry is the thing being removed, not the
-- expenditure.
--
-- `projects` is still Mongo, so `bills.project_id` and
-- `stock_requests.project_id` stay text. Their turn comes with projects.
-- ============================================================================

-- Anything that is not a uuid is a Mongo id for an asset that no longer
-- exists in this database — there is no register row for it to point at.
UPDATE "bill_lines"
   SET "asset_id" = NULL
 WHERE "asset_id" IS NOT NULL
   AND "asset_id" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';--> statement-breakpoint

UPDATE "bill_lines"
   SET "capitalized_asset_id" = NULL
 WHERE "capitalized_asset_id" IS NOT NULL
   AND "capitalized_asset_id" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';--> statement-breakpoint

-- And anything that IS a uuid but names no asset. Both are no-ops on a fresh
-- deployment; they are here so the constraint below cannot fail on a database
-- that has been used.
UPDATE "bill_lines" l
   SET "asset_id" = NULL
 WHERE l."asset_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "assets" a WHERE a.id = l."asset_id"::uuid);--> statement-breakpoint

UPDATE "bill_lines" l
   SET "capitalized_asset_id" = NULL
 WHERE l."capitalized_asset_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "assets" a WHERE a.id = l."capitalized_asset_id"::uuid);--> statement-breakpoint

-- The UPDATEs above queue DEFERRED constraint-trigger events on bill_lines,
-- and Postgres refuses to ALTER a table that has any pending:
--
--     cannot ALTER TABLE "bill_lines" because it has pending trigger events
--
-- Forcing them to fire now flushes the queue, so the type change can proceed
-- in the same migration. On a fresh deployment the UPDATEs match nothing and
-- this is a no-op.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint

ALTER TABLE "bill_lines"
  ALTER COLUMN "asset_id" TYPE uuid USING NULLIF("asset_id", '')::uuid;--> statement-breakpoint

ALTER TABLE "bill_lines"
  ALTER COLUMN "capitalized_asset_id" TYPE uuid USING NULLIF("capitalized_asset_id", '')::uuid;--> statement-breakpoint

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null;--> statement-breakpoint

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_capitalized_asset_id_fk"
  FOREIGN KEY ("capitalized_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null;--> statement-breakpoint

-- A bill line is capitalised into ONE asset, and an asset comes from ONE bill
-- line. `createAsset` guards this with a conditional UPDATE — the same guard
-- Mongo writes as `findOneAndUpdate({ "lines.capitalizedAssetId": null })` —
-- and this is the floor under it.
CREATE UNIQUE INDEX "bill_lines_capitalized_once"
  ON "bill_lines" ("capitalized_asset_id")
  WHERE "capitalized_asset_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "bill_lines_asset_idx"
  ON "bill_lines" ("company_id", "asset_id")
  WHERE "asset_id" IS NOT NULL;
