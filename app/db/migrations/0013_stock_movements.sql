CREATE TYPE "public"."movement_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."movement_status" AS ENUM('pending', 'completed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('issue', 'return', 'sale', 'purchase', 'adjustment', 'damage', 'transfer', 'initial');--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"movement_number" text NOT NULL,
	"product_id" uuid NOT NULL,
	"product_sku_at_movement" text DEFAULT '' NOT NULL,
	"product_name_at_movement" text DEFAULT '' NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"direction" "movement_direction" NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"previous_stock" numeric(19, 4) NOT NULL,
	"new_stock" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(19, 4),
	"total_value" numeric(19, 4),
	"average_cost_at_movement" numeric(19, 4),
	"journal_entry_id" uuid,
	"cogs_journal_entry_id" uuid,
	"affects_accounting" boolean DEFAULT true NOT NULL,
	"invoice_line_id" uuid,
	"source_reference" text,
	"performed_by_id" uuid,
	"performed_by_name_at_movement" text,
	"issued_to_id" uuid,
	"issued_to_name_at_movement" text,
	"requires_return" boolean DEFAULT false NOT NULL,
	"expected_return_date" date,
	"actual_return_date" date,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"status" "movement_status" DEFAULT 'completed' NOT NULL,
	"is_reversed" boolean DEFAULT false NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by_id" uuid,
	"original_movement_id" uuid,
	"movement_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_positive" CHECK ("stock_movements"."quantity" > 0),
	CONSTRAINT "stock_movements_costs_non_negative" CHECK ("stock_movements"."unit_cost" >= 0 AND "stock_movements"."total_cost" >= 0),
	CONSTRAINT "stock_movements_levels_non_negative" CHECK ("stock_movements"."previous_stock" >= 0 AND "stock_movements"."new_stock" >= 0),
	CONSTRAINT "stock_movements_levels_consistent" CHECK (("stock_movements"."direction" = 'in'  AND "stock_movements"."new_stock" = "stock_movements"."previous_stock" + "stock_movements"."quantity")
       OR ("stock_movements"."direction" = 'out' AND "stock_movements"."new_stock" = "stock_movements"."previous_stock" - "stock_movements"."quantity"))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cogs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("cogs_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_issued_to_id_parties_id_fk" FOREIGN KEY ("issued_to_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_original_movement_id_stock_movements_id_fk" FOREIGN KEY ("original_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_company_number_uq" ON "stock_movements" USING btree ("company_id","movement_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_id_company_uq" ON "stock_movements" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "stock_movements_company_product_idx" ON "stock_movements" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_company_date_idx" ON "stock_movements" USING btree ("company_id","movement_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movements_company_type_idx" ON "stock_movements" USING btree ("company_id","movement_type");--> statement-breakpoint
CREATE INDEX "stock_movements_invoice_line_idx" ON "stock_movements" USING btree ("invoice_line_id") WHERE "stock_movements"."invoice_line_id" IS NOT NULL;