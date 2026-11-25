-- ============================================================================
-- OTHER MODULES HAND THEIR MONEY TO FINANCE
--
-- Three places where money changed hands with nothing reaching the books:
--
--   * training with a cost       → a draft expense, for finance to post
--   * a finished calibration job
--     or inspection               → a draft invoice to the client
--   * a paid web-shop order       → a draft invoice to the customer
--
-- Each record keeps a link to what it raised, so it is raised once, and the
-- record shows where its money went.
--
-- SAFE TO APPLY because: nullable columns, and one with a default.
-- ============================================================================

ALTER TABLE "hr_training_records" ADD COLUMN "expense_id" uuid REFERENCES "expenses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "calibration_jobs" ADD COLUMN "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "billing_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_billing_valid" CHECK ("billing_status" IN ('pending', 'invoiced', 'not_billable'));--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;
