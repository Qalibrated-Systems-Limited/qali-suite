CREATE TYPE "public"."bill_line_account_type" AS ENUM('expense', 'asset');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credit_note_item_type" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."credit_note_reason" AS ENUM('return', 'damaged', 'overcharge', 'cancellation', 'discount', 'defective', 'other');--> statement-breakpoint
CREATE TYPE "public"."credit_note_status" AS ENUM('draft', 'issued', 'applied', 'void');--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	"product_id" uuid,
	"account_id" uuid NOT NULL,
	"account_code_at_bill" text NOT NULL,
	"account_name_at_bill" text NOT NULL,
	"account_type" "bill_line_account_type" NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"amount" numeric(19, 4) GENERATED ALWAYS AS ((quantity * unit_price)::numeric(19,4)) STORED,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(19, 4) GENERATED ALWAYS AS ((quantity * unit_price * vat_rate / 100)::numeric(19,4)) STORED,
	"line_total" numeric(19, 4) GENERATED ALWAYS AS ((quantity * unit_price + quantity * unit_price * vat_rate / 100)::numeric(19,4)) STORED,
	"weighbridge_ticket_id" uuid,
	"purchase_order_id" uuid,
	"purchase_order_line_number" integer,
	"asset_id" uuid,
	"asset_number_at_bill" text,
	"asset_name_at_bill" text,
	"capitalized_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_lines_quantity_positive" CHECK ("bill_lines"."quantity" > 0),
	CONSTRAINT "bill_lines_unit_price_non_negative" CHECK ("bill_lines"."unit_price" >= 0),
	CONSTRAINT "bill_lines_vat_rate_range" CHECK ("bill_lines"."vat_rate" >= 0 AND "bill_lines"."vat_rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bill_number" text NOT NULL,
	"supplier_invoice_number" text,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_name_at_bill" text NOT NULL,
	"supplier_tax_pin_at_bill" text,
	"supplier_email_at_bill" text,
	"supplier_phone_at_bill" text,
	"supplier_address_at_bill" text,
	"wht_applicable" boolean DEFAULT false NOT NULL,
	"wht_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"wht_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total" numeric(19, 4) GENERATED ALWAYS AS (subtotal + vat_amount) STORED,
	"net_payable" numeric(19, 4) GENERATED ALWAYS AS (subtotal + vat_amount - wht_amount) STORED,
	"amount_paid" numeric(19, 4) DEFAULT '0' NOT NULL,
	"balance" numeric(19, 4) GENERATED ALWAYS AS (subtotal + vat_amount - wht_amount - amount_paid) STORED,
	"currency" text DEFAULT 'KES' NOT NULL,
	"status" "bill_status" DEFAULT 'draft' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"is_opening_balance" boolean DEFAULT false NOT NULL,
	"title" text,
	"reference" text,
	"description" text,
	"internal_notes" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by_id" uuid,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"cancellation_reason" text,
	"journal_entry_id" uuid,
	"inventory_moved" boolean DEFAULT true NOT NULL,
	"used_grni" boolean DEFAULT false NOT NULL,
	"purchase_order_id" uuid,
	"purchase_order_number_at_bill" text,
	"project_id" uuid,
	"project_number_at_bill" text,
	"project_name_at_bill" text,
	"cost_code_id" uuid,
	"cost_code_at_bill" text,
	"cost_code_name_at_bill" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_not_overpaid" CHECK ("bills"."balance" >= 0),
	CONSTRAINT "bills_amounts_non_negative" CHECK ("bills"."subtotal" >= 0 AND "bills"."vat_amount" >= 0 AND "bills"."wht_amount" >= 0 AND "bills"."amount_paid" >= 0),
	CONSTRAINT "bills_wht_rate_range" CHECK ("bills"."wht_rate" >= 0 AND "bills"."wht_rate" <= 30),
	CONSTRAINT "bills_wht_within_total" CHECK ("bills"."wht_amount" <= "bills"."subtotal" + "bills"."vat_amount"),
	CONSTRAINT "bills_due_on_or_after_bill_date" CHECK ("bills"."due_date" >= "bills"."bill_date")
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"original_invoice_line_id" uuid,
	"item_type" "credit_note_item_type" NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"original_quantity" numeric(19, 4),
	"original_unit_price" numeric(19, 4),
	"unit_price" numeric(19, 4) NOT NULL,
	"amount" numeric(19, 4) GENERATED ALWAYS AS ((quantity * unit_price)::numeric(19,4)) STORED,
	"tax_rate" numeric(5, 2) DEFAULT '16' NOT NULL,
	"tax_amount" numeric(19, 4) GENERATED ALWAYS AS ((quantity * unit_price * tax_rate / 100)::numeric(19,4)) STORED,
	"restore_inventory" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_lines_quantity_positive" CHECK ("credit_note_lines"."quantity" > 0),
	CONSTRAINT "credit_note_lines_unit_price_non_negative" CHECK ("credit_note_lines"."unit_price" >= 0),
	CONSTRAINT "credit_note_lines_tax_rate_range" CHECK ("credit_note_lines"."tax_rate" >= 0 AND "credit_note_lines"."tax_rate" <= 100),
	CONSTRAINT "credit_note_lines_product_required" CHECK (("credit_note_lines"."item_type" = 'product') = ("credit_note_lines"."product_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"credit_note_number" text NOT NULL,
	"credit_note_date" date NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number_at_issue" text NOT NULL,
	"invoice_date_at_issue" date,
	"invoice_total_at_issue" numeric(19, 4),
	"customer_id" uuid NOT NULL,
	"customer_name_at_issue" text NOT NULL,
	"customer_email_at_issue" text,
	"customer_phone_at_issue" text,
	"customer_address_at_issue" text,
	"customer_tax_pin_at_issue" text,
	"reason" "credit_note_reason" NOT NULL,
	"reason_description" text NOT NULL,
	"subtotal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total" numeric(19, 4) GENERATED ALWAYS AS (subtotal + tax_amount) STORED,
	"amount_applied" numeric(19, 4) DEFAULT '0' NOT NULL,
	"amount_remaining" numeric(19, 4) GENERATED ALWAYS AS (subtotal + tax_amount - amount_applied) STORED,
	"currency" text DEFAULT 'KES' NOT NULL,
	"status" "credit_note_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"inventory_journal_entry_id" uuid,
	"issued_at" timestamp with time zone,
	"issued_by_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_not_over_applied" CHECK ("credit_notes"."amount_remaining" >= 0),
	CONSTRAINT "credit_notes_amounts_non_negative" CHECK ("credit_notes"."subtotal" >= 0 AND "credit_notes"."tax_amount" >= 0 AND "credit_notes"."amount_applied" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_inventory_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("inventory_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_lines_bill_line_uq" ON "bill_lines" USING btree ("bill_id","line_number");--> statement-breakpoint
CREATE INDEX "bill_lines_bill_idx" ON "bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_lines_company_product_idx" ON "bill_lines" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "bill_lines_company_account_idx" ON "bill_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_company_number_uq" ON "bills" USING btree ("company_id","bill_number");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_id_company_uq" ON "bills" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "bills_company_supplier_idx" ON "bills" USING btree ("company_id","supplier_id","status");--> statement-breakpoint
CREATE INDEX "bills_company_date_status_idx" ON "bills" USING btree ("company_id","bill_date" DESC NULLS LAST,"status");--> statement-breakpoint
CREATE INDEX "bills_company_supplier_invoice_idx" ON "bills" USING btree ("company_id","supplier_invoice_number");--> statement-breakpoint
CREATE INDEX "bills_aging_idx" ON "bills" USING btree ("company_id","due_date") WHERE "bills"."status" = 'approved' AND "bills"."payment_status" <> 'paid';--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_lines_note_line_uq" ON "credit_note_lines" USING btree ("credit_note_id","line_number");--> statement-breakpoint
CREATE INDEX "credit_note_lines_note_idx" ON "credit_note_lines" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_company_product_idx" ON "credit_note_lines" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_company_number_uq" ON "credit_notes" USING btree ("company_id","credit_note_number");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_id_company_uq" ON "credit_notes" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "credit_notes_company_invoice_idx" ON "credit_notes" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_company_customer_idx" ON "credit_notes" USING btree ("company_id","customer_id","status");--> statement-breakpoint
CREATE INDEX "credit_notes_company_date_status_idx" ON "credit_notes" USING btree ("company_id","credit_note_date" DESC NULLS LAST,"status");