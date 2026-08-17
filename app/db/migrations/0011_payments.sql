-- NOTE: statements re-adding columns already created by hand in 0008-0010
-- were removed. drizzle-kit's snapshot only tracks schema-derived
-- generation, so custom-SQL columns are invisible to it and get emitted
-- again. The 0011 snapshot now records them, so later generations diff
-- correctly. Prefer declaring columns in the schema and reserving custom
-- SQL for what drizzle cannot express: triggers, views, RLS, constraints.
CREATE TYPE "public"."allocation_document_type" AS ENUM('invoice', 'bill');--> statement-breakpoint
-- invoice_source_type is created in 0010 (hand-written); drizzle-kit's
-- snapshot did not record it, so it was emitted here a second time. Removed.--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'mpesa', 'bank_transfer', 'cheque', 'card');--> statement-breakpoint
CREATE TYPE "public"."payment_record_status" AS ENUM('draft', 'pending_clearance', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('received', 'made');--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_type" "allocation_document_type" NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number_at_allocation" text NOT NULL,
	"original_amount" numeric(19, 4) NOT NULL,
	"balance_before" numeric(19, 4) NOT NULL,
	"amount_allocated" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount_allocated" > 0),
	CONSTRAINT "payment_allocations_balances_non_negative" CHECK ("payment_allocations"."original_amount" >= 0 AND "payment_allocations"."balance_before" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_number" text NOT NULL,
	"payment_type" "payment_type" NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"party_id" uuid NOT NULL,
	"party_name_at_payment" text NOT NULL,
	"party_email_at_payment" text,
	"party_phone_at_payment" text,
	"account_id" uuid NOT NULL,
	"account_code_at_payment" text NOT NULL,
	"account_name_at_payment" text NOT NULL,
	"mpesa_receipt" text,
	"bank_reference" text,
	"cheque_number" text,
	"reference" text,
	"description" text,
	"notes" text,
	"status" "payment_record_status" DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"journal_entry_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_document_uq" ON "payment_allocations" USING btree ("payment_id","document_type","document_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_document_idx" ON "payment_allocations" USING btree ("company_id","document_type","document_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_company_number_uq" ON "payments" USING btree ("company_id","payment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_id_company_uq" ON "payments" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "payments_company_party_idx" ON "payments" USING btree ("company_id","party_id");--> statement-breakpoint
CREATE INDEX "payments_company_date_idx" ON "payments" USING btree ("company_id","payment_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_company_status_idx" ON "payments" USING btree ("company_id","status");