-- ─────────────────────────────────────────────────────────────────────────────
-- 0113 — Inter-Company.
--
-- Sister-company contracts and the transactions that settle them — two real,
-- company-scoped, RLS'd tables replacing the dummy Inter-Company page. Contract
-- numbers from next_entry_number('IC'); transactions cascade from their
-- contract. "Collected", "outstanding" and settled/partial/outstanding status
-- are DERIVED from the transactions at read time. Touches only these two tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "intercompany_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_number" text NOT NULL,
	"sister_company" text NOT NULL,
	"sister_company_party_id" text,
	"contract_type" text DEFAULT 'mgmt_fee' NOT NULL,
	"contract_value" double precision DEFAULT 0 NOT NULL,
	"fee" double precision DEFAULT 0 NOT NULL,
	"min_required" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_active" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intercompany_contracts_sister_not_blank" CHECK (length(btrim("sister_company")) > 0),
	CONSTRAINT "intercompany_contracts_type_valid" CHECK ("contract_type" IN ('mgmt_fee','shared_services','royalty','license','loan','other'))
);
--> statement-breakpoint

CREATE TABLE "intercompany_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"transaction_type" text DEFAULT '' NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'invoiced' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intercompany_txn_status_valid" CHECK ("status" IN ('invoiced','collected','overdue','written_off'))
);
--> statement-breakpoint

ALTER TABLE "intercompany_contracts" ADD CONSTRAINT "intercompany_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_contracts" ADD CONSTRAINT "intercompany_contracts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_contracts" ADD CONSTRAINT "intercompany_contracts_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."intercompany_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "intercompany_contracts_company_number_idx" ON "intercompany_contracts" USING btree ("company_id","contract_number");--> statement-breakpoint
CREATE INDEX "intercompany_contracts_sister_idx" ON "intercompany_contracts" USING btree ("company_id","sister_company");--> statement-breakpoint
CREATE INDEX "intercompany_txn_contract_idx" ON "intercompany_transactions" USING btree ("contract_id","txn_date");--> statement-breakpoint
CREATE INDEX "intercompany_txn_company_idx" ON "intercompany_transactions" USING btree ("company_id","status");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['intercompany_contracts','intercompany_transactions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
