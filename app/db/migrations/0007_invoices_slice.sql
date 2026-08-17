CREATE TYPE "public"."cogs_source" AS ENUM('invoice', 'weighbridge');--> statement-breakpoint
CREATE TYPE "public"."costing_method" AS ENUM('average', 'fifo', 'lifo', 'specific', 'weighted_average');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_source" AS ENUM('inventory', 'stock_request', 'checkout', 'weighbridge');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partial', 'paid', 'overpaid');--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"product_type" text DEFAULT 'Inventory Item' NOT NULL,
	"quantity_on_hand" numeric(19, 4) DEFAULT '0' NOT NULL,
	"quantity_committed" numeric(19, 4) DEFAULT '0' NOT NULL,
	"quantity_on_hold" numeric(19, 4) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(19, 4) DEFAULT '0' NOT NULL,
	"cost_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"last_purchase_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"last_purchase_date" date,
	"costing_method" "costing_method" DEFAULT 'average' NOT NULL,
	"selling_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"wholesale_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"minimum_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"last_modified_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_quantities_non_negative" CHECK ("products"."quantity_on_hand" >= 0 AND "products"."quantity_committed" >= 0 AND "products"."quantity_on_hold" >= 0),
	CONSTRAINT "products_prices_non_negative" CHECK ("products"."cost_price" >= 0 AND "products"."selling_price" >= 0 AND "products"."minimum_price" >= 0),
	CONSTRAINT "products_commitments_within_on_hand" CHECK ("products"."quantity_committed" + "products"."quantity_on_hold" <= "products"."quantity_on_hand")
);
--> statement-breakpoint
CREATE TABLE "item_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"checkout_number" text NOT NULL,
	"product_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"checked_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_number" text NOT NULL,
	"technician_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weighbridge_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"transaction_type" text NOT NULL,
	"product_id" uuid,
	"net_weight" numeric(19, 4),
	"weight_unit" text DEFAULT 'kg' NOT NULL,
	"vehicle_reg" text,
	"ticket_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cogs_postings" (
	"invoice_line_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"posted_by" "cogs_source" NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,
	"total_cost" numeric(19, 4) NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cogs_postings_quantity_positive" CHECK ("cogs_postings"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text,
	"quantity" numeric(19, 4) NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"fulfilment_source" "fulfilment_source" DEFAULT 'inventory' NOT NULL,
	"stock_request_id" uuid,
	"checkout_id" uuid,
	"weighbridge_ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_quantity_positive" CHECK ("invoice_lines"."quantity" > 0),
	CONSTRAINT "invoice_lines_amounts_non_negative" CHECK ("invoice_lines"."unit_price" >= 0 AND "invoice_lines"."unit_cost" >= 0 AND "invoice_lines"."discount_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"customer_id" uuid NOT NULL,
	"title" text,
	"notes" text,
	"subtotal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"discount_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"amount_paid" numeric(19, 4) DEFAULT '0' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"revenue_entry_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amounts_non_negative" CHECK ("invoices"."subtotal" >= 0 AND "invoices"."total" >= 0 AND "invoices"."amount_paid" >= 0 AND "invoices"."tax_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_technician_id_parties_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_postings" ADD CONSTRAINT "cogs_postings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_postings" ADD CONSTRAINT "cogs_postings_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_revenue_entry_id_journal_entries_id_fk" FOREIGN KEY ("revenue_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_sku_uq" ON "products" USING btree ("company_id","sku");--> statement-breakpoint
CREATE INDEX "products_company_name_idx" ON "products" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "products_company_category_idx" ON "products" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX "products_company_reorder_idx" ON "products" USING btree ("company_id","quantity_on_hand") WHERE "products"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "item_checkouts_company_number_uq" ON "item_checkouts" USING btree ("company_id","checkout_number");--> statement-breakpoint
CREATE UNIQUE INDEX "item_checkouts_id_company_uq" ON "item_checkouts" USING btree ("id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requests_company_number_uq" ON "stock_requests" USING btree ("company_id","request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requests_id_company_uq" ON "stock_requests" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "stock_requests_company_technician_idx" ON "stock_requests" USING btree ("company_id","technician_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weighbridge_tickets_company_number_uq" ON "weighbridge_tickets" USING btree ("company_id","ticket_number");--> statement-breakpoint
CREATE UNIQUE INDEX "weighbridge_tickets_id_company_uq" ON "weighbridge_tickets" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "cogs_postings_company_idx" ON "cogs_postings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "cogs_postings_entry_idx" ON "cogs_postings" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_invoice_line_uq" ON "invoice_lines" USING btree ("invoice_id","line_number");--> statement-breakpoint
CREATE INDEX "invoice_lines_company_product_idx" ON "invoice_lines" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_company_number_uq" ON "invoices" USING btree ("company_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_id_company_uq" ON "invoices" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "invoices_company_customer_idx" ON "invoices" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoices_company_date_status_idx" ON "invoices" USING btree ("company_id","invoice_date" DESC NULLS LAST,"status");--> statement-breakpoint
CREATE INDEX "invoices_aging_idx" ON "invoices" USING btree ("company_id","due_date") WHERE "invoices"."status" = 'completed' AND "invoices"."payment_status" <> 'paid';