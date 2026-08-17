CREATE TYPE "public"."tax_source_document_type" AS ENUM('invoice', 'bill', 'journal_entry', 'other');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('vat_input', 'vat_output', 'wht', 'wht_received', 'paye', 'nssf', 'shif', 'nhif', 'housing_levy', 'excise_duty', 'advance_tax', 'dst', 'turnover_tax', 'cgt', 'other');--> statement-breakpoint
CREATE TABLE "tax_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"transaction_number" text NOT NULL,
	"transaction_date" date NOT NULL,
	"tax_type" "tax_type" NOT NULL,
	"tax_code" text NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"base_amount" numeric(19, 4) NOT NULL,
	"tax_amount" numeric(19, 4) NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"party_id" uuid NOT NULL,
	"party_type" "party_type" NOT NULL,
	"party_name_at_transaction" text NOT NULL,
	"party_tax_pin_at_transaction" text,
	"party_email_at_transaction" text,
	"party_phone_at_transaction" text,
	"source_document_type" "tax_source_document_type" NOT NULL,
	"source_document_id" uuid NOT NULL,
	"source_document_number" text,
	"source_document_date" date,
	"filing_period" text NOT NULL,
	"filed" boolean DEFAULT false NOT NULL,
	"filed_at" timestamp with time zone,
	"filed_by_id" uuid,
	"filing_reference" text,
	"remitted" boolean DEFAULT false NOT NULL,
	"remitted_at" timestamp with time zone,
	"remitted_by_id" uuid,
	"remittance_reference" text,
	"certificate_issued" boolean DEFAULT false NOT NULL,
	"certificate_number" text,
	"certificate_issued_at" timestamp with time zone,
	"reconciled" boolean DEFAULT false NOT NULL,
	"reconciled_at" timestamp with time zone,
	"reconciled_by_id" uuid,
	"reconciliation_notes" text,
	"journal_entry_id" uuid,
	"account_id" uuid NOT NULL,
	"account_code_at_transaction" text NOT NULL,
	"account_name_at_transaction" text NOT NULL,
	"description" text,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_transactions_amounts_non_negative" CHECK ("tax_transactions"."base_amount" >= 0 AND "tax_transactions"."tax_amount" >= 0 AND "tax_transactions"."total_amount" >= 0),
	CONSTRAINT "tax_transactions_rate_range" CHECK ("tax_transactions"."tax_rate" >= 0 AND "tax_transactions"."tax_rate" <= 100),
	CONSTRAINT "tax_transactions_filing_period_format" CHECK ("tax_transactions"."filing_period" ~ '^\d{4}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_transactions_company_number_uq" ON "tax_transactions" USING btree ("company_id","transaction_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_transactions_id_company_uq" ON "tax_transactions" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "tax_transactions_company_date_type_idx" ON "tax_transactions" USING btree ("company_id","transaction_date" DESC NULLS LAST,"tax_type");--> statement-breakpoint
CREATE INDEX "tax_transactions_company_party_type_idx" ON "tax_transactions" USING btree ("company_id","party_id","tax_type");--> statement-breakpoint
CREATE INDEX "tax_transactions_company_period_type_idx" ON "tax_transactions" USING btree ("company_id","filing_period","tax_type");--> statement-breakpoint
CREATE INDEX "tax_transactions_source_idx" ON "tax_transactions" USING btree ("company_id","source_document_type","source_document_id");--> statement-breakpoint
CREATE INDEX "tax_transactions_unfiled_idx" ON "tax_transactions" USING btree ("company_id","tax_type","filing_period") WHERE "tax_transactions"."filed" = false;--> statement-breakpoint
CREATE INDEX "tax_transactions_unremitted_idx" ON "tax_transactions" USING btree ("company_id","tax_type","filing_period") WHERE "tax_transactions"."remitted" = false;