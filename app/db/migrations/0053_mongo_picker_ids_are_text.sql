-- ============================================================================
-- 0053 — The pickers that hand Mongo ObjectIds to uuid columns.
--
-- Bills and stock requests are on Postgres. PROJECTS and ASSETS are not, and
-- are explicitly out of scope (§10). So the pickers on those forms are fed by
-- `getActiveProjects()` and an `Asset.find()`, both of which return 24-character
-- Mongo ObjectIds — and every column receiving one is typed `uuid`, which
-- rejects it outright:
--
--     invalid input syntax for type uuid: "507f1f77bcf86cd799439011"
--
-- The bill form ships BOTH pickers. `BillForm.jsx` renders a `ProjectPicker`
-- posting a hidden `projectId`, and an `AssetCombobox` per line posting a
-- hidden `assetId`; `bill-actions.ts` passes each through `optionalId`, which
-- only trims — it does not check the shape — and `bills.ts` writes them
-- straight in. So a bill saved with a project link OR an asset tag throws, and
-- has since those columns were created.
--
-- 0052 hit exactly this while porting claims and typed
-- `employee_claims.project_id` as `text` for this reason. These are the
-- columns that predate that discovery.
--
-- `text` is not a downgrade, it is the honest type: the value IS a Mongo
-- ObjectId today. When projects and assets land in Postgres these become uuid
-- and gain their foreign keys, in the migration that ports them — the same
-- deal 0052 wrote down for claims.
--
-- NOT changed here: `stock_requests.project_id` is also uuid, but nothing
-- writes it — `request-actions.ts` never reads the `projectId` its form posts,
-- so the link is silently dropped rather than rejected. Invoices have the same
-- silent drop with no column at all. Both are real, both are a different bug
-- (a lost value, not a failed save), and neither is fixed by a retype.
-- ============================================================================

ALTER TABLE "bills"
  ALTER COLUMN "project_id" TYPE text USING "project_id"::text;--> statement-breakpoint

ALTER TABLE "bill_lines"
  ALTER COLUMN "asset_id" TYPE text USING "asset_id"::text;--> statement-breakpoint

-- Set by the capitalisation path once a bill line becomes a fixed asset, and
-- read as a guard against doing it twice. It holds whatever id the asset store
-- issues, which is a Mongo ObjectId until assets move.
ALTER TABLE "bill_lines"
  ALTER COLUMN "capitalized_asset_id" TYPE text USING "capitalized_asset_id"::text;
