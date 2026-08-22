-- ============================================================================
-- 0054 — Project links the user picked and the database never saw.
--
-- 0053 fixed the loud half of this: bills threw when the project or asset
-- picker handed a Mongo ObjectId to a uuid column. These are the quiet half.
-- A person picks a project, the save SUCCEEDS, and the link is gone. There is
-- nothing to see and nothing to report, which is why it has lasted.
--
-- STOCK REQUESTS. `CreateRequestForm.jsx` posts a hidden `projectId`
-- (`formData.append("projectId", projectId)`). `request-actions.ts` never
-- reads it, and `CreateStockRequestInput` has no such field — so it is dropped
-- at the action boundary. The COLUMN has existed since 0020, along with
-- `project_number_at_request` and `project_name_at_request`, and
-- `fulfilment.ts` already reads them back out to render a project on the
-- request. It has been rendering NULL since the day it was written.
--
-- INVOICES. `CreateInvoiceForm.jsx` puts `projectId` into the JSON payload it
-- posts. Nothing in `app/db/validation/invoices.ts` or
-- `app/db/actions/invoice-actions.ts` mentions a project, and there is no
-- column at all. Added here.
--
-- Both `project_id`s are `text` for the reason 0053 spells out: the value is a
-- Mongo ObjectId until projects are ported. `cost_code_id` on stock requests
-- goes with it — same store, same shape, same trap waiting.
--
-- NOT done here: populating the `*_at_request` / `*_at_bill` snapshot columns.
-- Bills does not populate its pair either, and filling them means either
-- trusting a number the browser sent or reading Mongo from inside a Postgres
-- action. The link itself is what was lost; the snapshot is a separate
-- decision, and it belongs to whoever ports projects.
-- ============================================================================

ALTER TABLE "stock_requests"
  ALTER COLUMN "project_id" TYPE text USING "project_id"::text;--> statement-breakpoint

ALTER TABLE "stock_requests"
  ALTER COLUMN "cost_code_id" TYPE text USING "cost_code_id"::text;--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "project_number_at_invoice" text;--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "project_name_at_invoice" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoices_company_project_idx"
  ON "invoices" ("company_id", "project_id")
  WHERE "project_id" IS NOT NULL AND "project_id" <> '';
