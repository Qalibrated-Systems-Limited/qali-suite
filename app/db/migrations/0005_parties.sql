CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"is_employee" boolean DEFAULT false NOT NULL,
	"primary_type" "party_type" NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"email" text,
	"phone" text,
	"tax_pin" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"postal_code" text,
	"country" text DEFAULT 'Kenya' NOT NULL,
	"user_id" uuid,
	"employee_number" text,
	"department" text,
	"designation" text,
	"is_contractor" boolean DEFAULT false NOT NULL,
	"wht_applicable" boolean DEFAULT false NOT NULL,
	"wht_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"default_currency" text DEFAULT 'KES' NOT NULL,
	"credit_limit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"bank_name" text,
	"bank_account_number" text,
	"bank_branch" text,
	"bank_swift_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"last_modified_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_wht_rate_range" CHECK ("parties"."wht_rate" BETWEEN 0 AND 20),
	CONSTRAINT "parties_credit_limit_non_negative" CHECK ("parties"."credit_limit" >= 0),
	CONSTRAINT "parties_payment_terms_non_negative" CHECK ("parties"."payment_terms_days" >= 0),
	CONSTRAINT "parties_primary_type_matches_role" CHECK (("parties"."primary_type" = 'customer' AND "parties"."is_customer")
       OR ("parties"."primary_type" = 'supplier' AND "parties"."is_supplier")
       OR ("parties"."primary_type" = 'employee' AND "parties"."is_employee")
       OR ("parties"."primary_type" = 'other'))
);
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_company_name_idx" ON "parties" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "parties_company_type_active_idx" ON "parties" USING btree ("company_id","primary_type","is_active");--> statement-breakpoint
CREATE INDEX "parties_company_email_idx" ON "parties" USING btree ("company_id","email") WHERE "parties"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "parties_company_taxpin_idx" ON "parties" USING btree ("company_id","tax_pin") WHERE "parties"."tax_pin" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "parties_company_user_idx" ON "parties" USING btree ("company_id","user_id") WHERE "parties"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_company_employee_number_uq" ON "parties" USING btree ("company_id","employee_number") WHERE "parties"."employee_number" IS NOT NULL AND "parties"."employee_number" <> '';