CREATE TYPE "public"."checkout_reminder_method" AS ENUM('email', 'sms', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."checkout_reminder_type" AS ENUM('upcoming', 'due_today', 'overdue', 'final_warning');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('checked_out', 'returned', 'overdue', 'lost', 'damaged', 'converted_to_sale', 'expensed');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_status" AS ENUM('pending', 'partial', 'complete');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."requester_department" AS ENUM('Technical', 'Sales', 'Service', 'Installation', 'Admin', 'Finance', 'Other');--> statement-breakpoint
CREATE TYPE "public"."return_condition" AS ENUM('excellent', 'good', 'fair', 'poor', 'damaged', 'lost');--> statement-breakpoint
CREATE TYPE "public"."return_required_reason" AS ENUM('invoice_expired', 'invoice_cancelled', 'sale_failed', 'other');--> statement-breakpoint
CREATE TYPE "public"."stock_removal_purpose" AS ENUM('sale', 'technician_test', 'customer_demo', 'internal_use', 'installation', 'repair', 'other');--> statement-breakpoint
CREATE TYPE "public"."stock_request_status" AS ENUM('pending', 'approved', 'partially_fulfilled', 'fulfilled', 'invoiced', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_request_type" AS ENUM('sale', 'demo', 'installation', 'internal', 'repair', 'employee_borrow');--> statement-breakpoint
CREATE TYPE "public"."wb_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."wb_status" AS ENUM('pending', 'first_recorded', 'completed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."wb_transaction_type" AS ENUM('purchase', 'sale', 'sale_standalone', 'transfer_out', 'transfer_in', 'return_to_supplier', 'customer_return');--> statement-breakpoint
CREATE TYPE "public"."wb_weight_unit" AS ENUM('kg', 't');--> statement-breakpoint
CREATE TABLE "checkout_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"reminder_type" "checkout_reminder_type" NOT NULL,
	"method" "checkout_reminder_method" NOT NULL,
	"sent_to" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_request_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"approver_id" uuid,
	"approver_name_at_action" text NOT NULL,
	"action" text NOT NULL,
	"comments" text,
	"acted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_request_approvals_action_valid" CHECK ("stock_request_approvals"."action" IN ('approved', 'rejected', 'requested_changes'))
);
--> statement-breakpoint
CREATE TABLE "stock_request_fulfilments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"serial_numbers" text[],
	"fulfilled_by_id" uuid,
	"fulfilled_by_name_at_fulfilment" text,
	"fulfilled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"movement_id" uuid,
	"checkout_id" uuid,
	"delivery_note_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_request_fulfilments_quantity_positive" CHECK ("stock_request_fulfilments"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_request_item_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number_at_invoicing" text NOT NULL,
	"quantity" numeric(19, 4) NOT NULL,
	"invoiced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_request_item_invoices_quantity_positive" CHECK ("stock_request_item_invoices"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_at_request" text NOT NULL,
	"sku_at_request" text NOT NULL,
	"stock_at_request" numeric(19, 4) NOT NULL,
	"requested_quantity" numeric(19, 4) NOT NULL,
	"approved_quantity" numeric(19, 4),
	"unit_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"purpose" "stock_removal_purpose",
	"purpose_details" text,
	"requires_return" boolean DEFAULT false NOT NULL,
	"expected_return_date" date,
	"notes" text,
	"total_fulfilled" numeric(19, 4) DEFAULT '0' NOT NULL,
	"remaining_to_fulfil" numeric(19, 4) GENERATED ALWAYS AS (COALESCE(approved_quantity, requested_quantity) - total_fulfilled) STORED,
	"fulfilment_status" "fulfilment_status" DEFAULT 'pending' NOT NULL,
	"invoiced_quantity" numeric(19, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_request_items_requested_positive" CHECK ("stock_request_items"."requested_quantity" > 0),
	CONSTRAINT "stock_request_items_approved_within_requested" CHECK ("stock_request_items"."approved_quantity" IS NULL
          OR ("stock_request_items"."approved_quantity" >= 0 AND "stock_request_items"."approved_quantity" <= "stock_request_items"."requested_quantity")),
	CONSTRAINT "stock_request_items_amounts_non_negative" CHECK ("stock_request_items"."unit_price" >= 0 AND "stock_request_items"."total_fulfilled" >= 0 AND "stock_request_items"."invoiced_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "item_checkouts" DROP CONSTRAINT "item_checkouts_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_requests" DROP CONSTRAINT "stock_requests_technician_id_parties_id_fk";
--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" DROP CONSTRAINT "weighbridge_tickets_product_id_products_id_fk";
--> statement-breakpoint
DROP INDEX "stock_requests_company_technician_idx";--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "product_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "status" SET DEFAULT 'checked_out'::"public"."checkout_status";--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "status" SET DATA TYPE "public"."checkout_status" USING "status"::"public"."checkout_status";--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."stock_request_status";--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "status" SET DATA TYPE "public"."stock_request_status" USING "status"::"public"."stock_request_status";--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ALTER COLUMN "transaction_type" SET DATA TYPE "public"."wb_transaction_type" USING "transaction_type"::"public"."wb_transaction_type";--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" drop column "net_weight";--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ALTER COLUMN "weight_unit" SET DEFAULT 'kg'::"public"."wb_weight_unit";--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ALTER COLUMN "weight_unit" SET DATA TYPE "public"."wb_weight_unit" USING "weight_unit"::"public"."wb_weight_unit";--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "product_name_at_checkout" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "sku_at_checkout" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "category_at_checkout" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "quantity" numeric(19, 4) NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "serial_no" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_to_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_to_name_at_checkout" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_to_department" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_to_email" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_to_phone" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_by_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checked_out_by_name_at_checkout" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "purpose" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "purpose_details" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expected_return_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "actual_return_date" date;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "returned_by_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "returned_by_name_at_return" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_condition" "return_condition";--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_notes" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "damage_details" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "request_number_at_checkout" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "movement_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "request_type" "stock_request_type";--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "sale_converted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "sale_converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "sale_converted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "sale_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "sale_invoice_number_at_conversion" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "quantity_sold" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "quantity_returned" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expensed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expensed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expensed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expense_account_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expense_account_code_at_expense" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expense_account_name_at_expense" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expense_journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expense_reason" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "quantity_expensed" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "expense_total_cost" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_required_reason" "return_required_reason";--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_required_by_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "failed_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "failed_invoice_number" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_deadline" date;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "return_notifications_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "last_return_notification_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "customer_name_at_checkout" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "is_escalated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "escalated_to_id" uuid;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "escalated_to_name_at_escalation" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "escalation_reason" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "checkout_notes" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "request_type" "stock_request_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "priority" "request_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "customer_name_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "customer_email_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "customer_phone_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "customer_address_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "customer_tax_pin_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "requester_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "requester_name_at_request" text NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "requester_department" "requester_department" NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "requester_email" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "requester_phone" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "approved_by_name_at_approval" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "approval_comments" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "approval_conditions" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "rejected_by_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "total_value" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "required_by_date" date;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "draft_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "draft_invoice_number_at_creation" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "draft_invoice_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "project_number_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "project_name_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "cost_code_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "cost_code_at_request" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "direction" "wb_direction" NOT NULL;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "driver_name" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "driver_phone" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "product_name_at_ticket" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "product_code_at_ticket" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "party_name_at_ticket" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "first_weight" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "second_weight" numeric(19, 4);--> statement-breakpoint
-- MOVED: net_weight is GENERATED from the two weighings, so it is added
-- after them. drizzle-kit emitted it beside the DROP it replaces, which put
-- the generation expression before its own inputs existed.
ALTER TABLE "weighbridge_tickets" ADD COLUMN "net_weight" numeric(19, 4) GENERATED ALWAYS AS (abs(first_weight - second_weight)) STORED;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "first_weight_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "second_weight_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "first_weight_key_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "second_weight_key_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "status" "wb_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "internal_ref" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "internal_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "purchase_order_ref" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "invoice_ref" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "invoice_item_fulfilled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "bill_ref" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "transfer_ref" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "linked_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "transfer_cleared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "voided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "warnings" text[];--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "integration_key_id" uuid;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_reminders" ADD CONSTRAINT "checkout_reminders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request_approvals" ADD CONSTRAINT "stock_request_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request_fulfilments" ADD CONSTRAINT "stock_request_fulfilments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request_item_invoices" ADD CONSTRAINT "stock_request_item_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_reminders_checkout_idx" ON "checkout_reminders" USING btree ("checkout_id");--> statement-breakpoint
CREATE INDEX "checkout_reminders_company_sent_idx" ON "checkout_reminders" USING btree ("company_id","sent_at");--> statement-breakpoint
CREATE INDEX "stock_request_approvals_request_idx" ON "stock_request_approvals" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "stock_request_fulfilments_item_idx" ON "stock_request_fulfilments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stock_request_fulfilments_company_idx" ON "stock_request_fulfilments" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_request_item_invoices_item_invoice_uq" ON "stock_request_item_invoices" USING btree ("item_id","invoice_id");--> statement-breakpoint
CREATE INDEX "stock_request_item_invoices_invoice_idx" ON "stock_request_item_invoices" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_request_items_request_line_uq" ON "stock_request_items" USING btree ("request_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_request_items_id_company_uq" ON "stock_request_items" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "stock_request_items_request_idx" ON "stock_request_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "stock_request_items_company_product_idx" ON "stock_request_items" USING btree ("company_id","product_id");--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_expense_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("expense_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_linked_ticket_id_weighbridge_tickets_id_fk" FOREIGN KEY ("linked_ticket_id") REFERENCES "public"."weighbridge_tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_checkouts_company_status_idx" ON "item_checkouts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "item_checkouts_company_holder_idx" ON "item_checkouts" USING btree ("company_id","checked_out_to_id");--> statement-breakpoint
CREATE INDEX "item_checkouts_company_product_idx" ON "item_checkouts" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "item_checkouts_request_idx" ON "item_checkouts" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "item_checkouts_outstanding_idx" ON "item_checkouts" USING btree ("company_id","expected_return_date") WHERE "item_checkouts"."status" IN ('checked_out', 'overdue');--> statement-breakpoint
CREATE INDEX "item_checkouts_return_required_idx" ON "item_checkouts" USING btree ("company_id","return_deadline") WHERE "item_checkouts"."return_required" = true AND "item_checkouts"."status" = 'checked_out';--> statement-breakpoint
CREATE INDEX "stock_requests_company_status_idx" ON "stock_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "stock_requests_company_type_status_idx" ON "stock_requests" USING btree ("company_id","request_type","status");--> statement-breakpoint
CREATE INDEX "stock_requests_company_customer_idx" ON "stock_requests" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "stock_requests_company_requester_idx" ON "stock_requests" USING btree ("company_id","requester_id");--> statement-breakpoint
CREATE INDEX "stock_requests_open_idx" ON "stock_requests" USING btree ("company_id","required_by_date") WHERE "stock_requests"."status" IN ('pending', 'approved', 'partially_fulfilled');--> statement-breakpoint
CREATE UNIQUE INDEX "weighbridge_tickets_external_ref_uq" ON "weighbridge_tickets" USING btree ("company_id","external_ref") WHERE "weighbridge_tickets"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "weighbridge_tickets_company_status_idx" ON "weighbridge_tickets" USING btree ("company_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "weighbridge_tickets_company_type_idx" ON "weighbridge_tickets" USING btree ("company_id","transaction_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "weighbridge_tickets_company_vehicle_idx" ON "weighbridge_tickets" USING btree ("company_id","vehicle_reg");--> statement-breakpoint
CREATE INDEX "weighbridge_tickets_transfer_ref_idx" ON "weighbridge_tickets" USING btree ("company_id","transfer_ref");--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_quantity_positive" CHECK ("item_checkouts"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_disposition_within_quantity" CHECK ("item_checkouts"."quantity_sold" + "item_checkouts"."quantity_returned" + "item_checkouts"."quantity_expensed" <= "item_checkouts"."quantity");--> statement-breakpoint
ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_disposition_non_negative" CHECK ("item_checkouts"."quantity_sold" >= 0 AND "item_checkouts"."quantity_returned" >= 0 AND "item_checkouts"."quantity_expensed" >= 0);--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_customer_required_unless_internal" CHECK (("stock_requests"."request_type" IN ('internal', 'employee_borrow'))
          OR ("stock_requests"."customer_id" IS NOT NULL AND "stock_requests"."customer_name_at_request" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_total_value_non_negative" CHECK ("stock_requests"."total_value" >= 0);--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_weights_non_negative" CHECK (("weighbridge_tickets"."first_weight" IS NULL OR "weighbridge_tickets"."first_weight" >= 0)
          AND ("weighbridge_tickets"."second_weight" IS NULL OR "weighbridge_tickets"."second_weight" >= 0));--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_direction_matches_type" CHECK (("weighbridge_tickets"."direction" = 'inbound'
             AND "weighbridge_tickets"."transaction_type" IN ('purchase', 'transfer_in', 'customer_return'))
          OR ("weighbridge_tickets"."direction" = 'outbound'
             AND "weighbridge_tickets"."transaction_type" IN ('sale', 'sale_standalone', 'transfer_out', 'return_to_supplier')));