CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."fiscal_period_status" AS ENUM('open', 'closed', 'locked');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_type" AS ENUM('sale', 'payment_received', 'payment_made', 'expense', 'advance', 'purchase', 'adjustment', 'opening_balance', 'advance_settlement', 'invoice_cancellation', 'bill_cancellation', 'closing', 'transfer', 'credit_note', 'debit_note', 'depreciation', 'write_off', 'payroll', 'contra', 'bank_entry', 'cash_entry', 'accrual', 'revaluation', 'tax', 'inventory_adjustment', 'liability_payment', 'loan_disbursement', 'goods_receipt', 'goods_dispatch', 'asset_disposal', 'impairment', 'other');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('draft', 'posted', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('customer', 'supplier', 'employee', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_document_type" AS ENUM('invoice', 'payment', 'expense', 'bill', 'stock_movement', 'weighbridge_ticket');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_currency" text DEFAULT 'KES' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"account_name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"sub_type" text,
	"parent_id" uuid,
	"path" text,
	"level" integer DEFAULT 0 NOT NULL,
	"can_post" boolean DEFAULT true NOT NULL,
	"system_account" text,
	"currency" text DEFAULT 'KES' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"taxable" boolean DEFAULT false NOT NULL,
	"default_tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"bank_name" text,
	"bank_account_number" text,
	"bank_branch" text,
	"bank_swift_code" text,
	"created_by_id" uuid,
	"last_modified_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_level_range" CHECK ("accounts"."level" BETWEEN 0 AND 5),
	CONSTRAINT "accounts_tax_rate_range" CHECK ("accounts"."default_tax_rate" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"period_name" text NOT NULL,
	"period_code" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "fiscal_period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_periods_month_range" CHECK ("fiscal_periods"."month" BETWEEN 1 AND 12),
	CONSTRAINT "fiscal_periods_year_range" CHECK ("fiscal_periods"."year" BETWEEN 2018 AND 2100),
	CONSTRAINT "fiscal_periods_date_order" CHECK ("fiscal_periods"."end_date" > "fiscal_periods"."start_date")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" date NOT NULL,
	"entry_type" "journal_entry_type" NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"notes" text,
	"party_type" "party_type",
	"party_id" uuid,
	"due_date" date,
	"source_type" "source_document_type",
	"source_id" uuid,
	"status" "journal_status" DEFAULT 'draft' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by_id" uuid,
	"reversal_entry_id" uuid,
	"original_entry_id" uuid,
	"is_fully_paid" boolean DEFAULT false NOT NULL,
	"amount_paid" numeric(19, 4) DEFAULT '0' NOT NULL,
	"amount_outstanding" numeric(19, 4) DEFAULT '0' NOT NULL,
	"fiscal_period_id" uuid,
	"fiscal_year" integer,
	"fiscal_month" integer,
	"created_by_id" uuid,
	"last_modified_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_fiscal_month_range" CHECK ("journal_entries"."fiscal_month" IS NULL OR "journal_entries"."fiscal_month" BETWEEN 1 AND 12),
	CONSTRAINT "journal_entries_amounts_non_negative" CHECK ("journal_entries"."amount_paid" >= 0 AND "journal_entries"."amount_outstanding" >= 0),
	CONSTRAINT "journal_entries_party_pair" CHECK (("journal_entries"."party_type" IS NULL) = ("journal_entries"."party_id" IS NULL)),
	CONSTRAINT "journal_entries_source_pair" CHECK (("journal_entries"."source_type" IS NULL) = ("journal_entries"."source_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"debit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_debit_non_negative" CHECK ("journal_lines"."debit" >= 0),
	CONSTRAINT "journal_lines_credit_non_negative" CHECK ("journal_lines"."credit" >= 0),
	CONSTRAINT "journal_lines_one_sided" CHECK (("journal_lines"."debit" > 0) <> ("journal_lines"."credit" > 0))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_original_entry_id_journal_entries_id_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_code_uq" ON "accounts" USING btree ("company_id","account_code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_system_uq" ON "accounts" USING btree ("company_id","system_account") WHERE "accounts"."system_account" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounts_company_type_active_idx" ON "accounts" USING btree ("company_id","account_type","is_active");--> statement-breakpoint
CREATE INDEX "accounts_company_postable_idx" ON "accounts" USING btree ("company_id","can_post") WHERE "accounts"."is_active" = true;--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_company_code_uq" ON "fiscal_periods" USING btree ("company_id","period_code");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_company_year_month_uq" ON "fiscal_periods" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE INDEX "fiscal_periods_company_range_idx" ON "fiscal_periods" USING btree ("company_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_number_uq" ON "journal_entries" USING btree ("company_id","entry_number");--> statement-breakpoint
CREATE INDEX "journal_entries_company_date_status_idx" ON "journal_entries" USING btree ("company_id","entry_date" DESC NULLS LAST,"status");--> statement-breakpoint
CREATE INDEX "journal_entries_company_party_idx" ON "journal_entries" USING btree ("company_id","party_type","party_id");--> statement-breakpoint
CREATE INDEX "journal_entries_aging_idx" ON "journal_entries" USING btree ("company_id","party_type","due_date") WHERE "journal_entries"."is_fully_paid" = false AND "journal_entries"."status" = 'posted';--> statement-breakpoint
CREATE INDEX "journal_entries_company_period_idx" ON "journal_entries" USING btree ("company_id","fiscal_year","fiscal_month");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("company_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_entry_line_uq" ON "journal_lines" USING btree ("entry_id","line_number");--> statement-breakpoint
CREATE INDEX "journal_lines_company_account_idx" ON "journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");