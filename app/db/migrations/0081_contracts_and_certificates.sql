-- ─────────────────────────────────────────────────────────────────────────────
-- 0077 — The contract, and the interim payment certificate.
--
-- Steps 3 and 5 of `docs/PROJECTS-QALITRACK-PLAN.md` §8. They land together
-- because a certificate has nothing to compute against without contract terms,
-- and §7 is unambiguous that NOTHING about a contract may be hardcoded: the
-- retention percentage, its cap, the advance and its recovery rule are per
-- CONTRACT, because the next tenant runs different ones.
--
-- WHAT THIS REPLACES. "IPC & Payments" was a page that opened with a banner
-- admitting formal certificates were not a module yet, showing the invoices and
-- bills tagged to the project. `billing_model` has offered `milestone` since the
-- module shipped and there has never been a certificate in the system. This is
-- the record.
--
-- ── Eight decisions ─────────────────────────────────────────────────────────
--
-- 1. THE ARITHMETIC IS CUMULATIVE, AND ALMOST ALL OF IT IS DERIVED.
--    A certificate stores four numbers — the value of permanent work to date,
--    materials on site, dayworks to date, and retention released to date — and
--    every other figure on it is computed from those and the contract terms:
--
--        value of permanent work to date      ← cumulative
--      + materials on site
--      + dayworks to date
--      = gross valuation
--      − retention held        min(pct × gross, cap × contract sum)
--      + retention released
--      − advance recovered     min(pct × gross, advance paid)
--      = net to date
--      − previously certified (NET, from the last certified certificate)
--      = net this certificate
--
--    This is the form a real certificate takes, and it is not an aesthetic
--    choice: because every line is cumulative, a correction to certificate 2
--    flows into 3 by itself. A design that stored "this period" would need
--    every later certificate rewritten, which is how a final account stops
--    reconciling.
--
--    It is also the same rule as every other roll-up here — 0070 decision 5,
--    0071 decision 1, 0076 decision 2. Store what was observed; derive the rest.
--
-- 2. THE CERTIFICATE STOPS AT NET CERTIFIED. VAT, VAT withholding and WHT are
--    NOT on it. They belong to the tax invoice the certificate raises and to
--    the payment that settles it, and both of those already exist with a tested
--    tax engine behind them. Putting the rates here would be a second engine to
--    keep correct, and the one used less often is the one that drifts.
--
-- 3. CERTIFYING RAISES A DRAFT INVOICE, AND NOTHING MORE.
--    The same decision, and the same reversibility, as the execution layer's
--    milestone → draft invoice: a draft is reviewable, editable and deletable,
--    and it makes the certificate the SOURCE document without committing to
--    posting anything. It answers §6 open question 2 in the half that can be
--    undone.
--
-- 4. RETENTION IS A BALANCE DERIVED FROM THE CERTIFICATES, AND IT DOES NOT
--    REACH THE LEDGER YET.
--    Stated plainly so nobody reads this migration as finishing retention.
--    `1250 Retention Receivable` does not exist in the chart, and the journal
--    that moves retention out of receivables is step 6. What EXISTS here is the
--    balance — held, released, outstanding — and `retention_released_to_date`,
--    which is what makes the usual "half at taking-over, half at the end of the
--    defects period" expressible without a release-schedule table.
--
-- 5. A CONTRACT HAS A DIRECTION, FROM THE START.
--    `receivable` — we are the contractor and the employer holds retention on
--    us. `payable` — we are the employer and we hold it on a subcontractor,
--    back to back. Every construction system runs retention on both sides, and
--    retrofitting a direction onto a table that assumed one means every row
--    needs a value and every query needs a filter it did not have. One column
--    now. See §9.2.
--
--    At most one RECEIVABLE contract per project — that is the main contract,
--    and two of them would mean two contract sums. Subcontracts are as many
--    `payable` rows as there are subcontractors.
--
-- 6. THE CONTRACT SUM IS THE CONTRACT'S, AND `projects.contract_value` BECOMES
--    THE FALLBACK. Exactly what 0070 decision 5 did to the budget and 0076 did
--    to progress: one figure, one rule, stated once — the contract's sum where a
--    contract exists, the project's field where none does. `original_sum` sits
--    beside the current one so a variation can move the sum and the variance
--    stays answerable.
--
-- 7. MATERIALS ON SITE AND DAYWORKS ARE COLUMNS, NOT LINES.
--    Both are standard on an interim certificate and neither is a bill item —
--    nothing has been MEASURED for materials merely delivered. They are three
--    known components of one valuation, so they are three columns. If a tenant
--    ever needs to itemise what is on site, that is a line table hanging off
--    this one and it does not change the arithmetic above.
--
-- 8. A CERTIFIED CERTIFICATE IS FROZEN, AND ONLY ONE DRAFT EXISTS AT A TIME.
--    Same shape as an approved budget's lines (0070) and an awarded bill (0076).
--    A certificate is what the client was asked to pay against; editing an
--    issued one rewrites history that a payment already refers to. And two
--    half-made drafts against one contract is two people preparing the same
--    valuation without knowing it.
--
-- WHAT IS DELIBERATELY NOT HERE: the retention JOURNAL (step 6), the notice
-- clocks (step 7), and variations moving the contract sum (step 4) — the column
-- they will move is here, the register that triggers them is not.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."project_contract_direction" AS ENUM('receivable', 'payable');--> statement-breakpoint
CREATE TYPE "public"."project_certificate_status" AS ENUM('draft', 'certified', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_valuation_source" AS ENUM('measured', 'milestone', 'manual');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_contracts — the terms. Per contract, never per tenant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	-- Decision 5.
	"direction" "project_contract_direction" DEFAULT 'receivable' NOT NULL,

	"reference" text,
	"title" text,

	-- Who it is with: the employer on a receivable, the subcontractor on a
	-- payable. Nullable, because a public employer may not be a party record —
	-- but a name is required once an id is given, the same pair rule as the
	-- project's client and the task's assignee.
	"counterparty_party_id" uuid,
	"counterparty_name" text,

	-- Decision 6. `original_sum` so a variation can move `sum` and the variance
	-- stays answerable.
	"contract_sum" numeric(19, 4) DEFAULT 0 NOT NULL,
	"original_sum" numeric(19, 4) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,

	-- THE TERMS. Every one of these may be zero on a given contract, and zero is
	-- a term rather than a code path (§7). None of them has a default that
	-- pretends to know the tenant's contract.
	"retention_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	-- A cap expressed as a percentage of the contract sum — "10% retained, to a
	-- limit of 5% of the contract sum". NULL means uncapped.
	"retention_cap_percent" numeric(5, 2),
	"advance_amount" numeric(19, 4) DEFAULT 0 NOT NULL,
	"advance_recovery_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"defects_liability_months" integer,

	"commencement_date" date,
	"completion_date" date,
	"notes" text DEFAULT '' NOT NULL,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_contracts_sums_non_negative" CHECK (
		"contract_sum" >= 0 AND "original_sum" >= 0
	),
	CONSTRAINT "project_contracts_retention_in_range" CHECK (
		"retention_percent" BETWEEN 0 AND 100
		AND ("retention_cap_percent" IS NULL OR "retention_cap_percent" BETWEEN 0 AND 100)
	),
	CONSTRAINT "project_contracts_advance_sane" CHECK (
		"advance_amount" >= 0
		AND "advance_recovery_percent" BETWEEN 0 AND 100
	),
	-- An advance that is never recovered is an advance nobody asked to be repaid,
	-- and it is almost always a half-filled form rather than a term.
	CONSTRAINT "project_contracts_advance_is_recoverable" CHECK (
		"advance_amount" = 0 OR "advance_recovery_percent" > 0
	),
	CONSTRAINT "project_contracts_dlp_positive" CHECK (
		"defects_liability_months" IS NULL OR "defects_liability_months" > 0
	),
	CONSTRAINT "project_contracts_dates_ordered" CHECK (
		"commencement_date" IS NULL OR "completion_date" IS NULL
		OR "completion_date" >= "commencement_date"
	),
	CONSTRAINT "project_contracts_counterparty_pair" CHECK (
		"counterparty_party_id" IS NULL
		OR length(btrim(COALESCE("counterparty_name", ''))) > 0
	)
);
--> statement-breakpoint

ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_counterparty_party_id_parties_id_fk" FOREIGN KEY ("counterparty_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Decision 5: one main contract per project. Two receivables would be two
-- contract sums, and every figure derived from "the contract" would have to say
-- which one.
CREATE UNIQUE INDEX "project_contracts_one_receivable" ON "project_contracts" USING btree ("project_id") WHERE "project_contracts"."direction" = 'receivable';--> statement-breakpoint
CREATE UNIQUE INDEX "project_contracts_id_project_uq" ON "project_contracts" USING btree ("id","project_id");--> statement-breakpoint
CREATE INDEX "project_contracts_project_idx" ON "project_contracts" USING btree ("company_id","project_id","direction");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_certificates — the valuation.
--
-- Four stored numbers and the terms produce every figure on the certificate
-- (decision 1). Nothing here holds "this period": it is `net to date` minus the
-- previous certificate's `net to date`, computed on read.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,

	-- The tenant-wide document number, and the number WITHIN the contract —
	-- "IPC No. 3" is the one a certificate is argued about by.
	"certificate_number" text NOT NULL,
	"sequence" integer NOT NULL,

	"status" "project_certificate_status" DEFAULT 'draft' NOT NULL,

	"period_from" date,
	"period_to" date,
	"valuation_date" date DEFAULT CURRENT_DATE NOT NULL,

	-- Where the value of permanent work came from. `measured` is a remeasure
	-- against an awarded bill (0076) and is the only one that is evidence;
	-- `milestone` is a stage achieved; `manual` is somebody's figure. Recorded
	-- for the same reason `progress.source` is: three numbers that look
	-- identical on a certificate and only one of them can be defended.
	"valuation_source" "project_valuation_source" DEFAULT 'manual' NOT NULL,

	-- THE FOUR STORED NUMBERS. All CUMULATIVE, all as at `valuation_date`.
	"work_done_to_date" numeric(19, 4) DEFAULT 0 NOT NULL,
	"materials_on_site" numeric(19, 4) DEFAULT 0 NOT NULL,
	"dayworks_to_date" numeric(19, 4) DEFAULT 0 NOT NULL,
	-- Decision 4: what makes "half at taking-over, half at the end of the
	-- defects period" expressible without a release-schedule table.
	"retention_released_to_date" numeric(19, 4) DEFAULT 0 NOT NULL,

	"notes" text DEFAULT '' NOT NULL,

	-- Decision 3. Nullable: a certificate can be issued without raising the
	-- invoice, and deleting the draft invoice must not delete the certificate.
	"invoice_id" uuid,

	"certified_by_id" text,
	"certified_by_name" text,
	"certified_at" timestamp with time zone,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_certificates_sequence_positive" CHECK ("sequence" > 0),
	CONSTRAINT "project_certificates_amounts_non_negative" CHECK (
		"work_done_to_date" >= 0
		AND "materials_on_site" >= 0
		AND "dayworks_to_date" >= 0
		AND "retention_released_to_date" >= 0
	),
	CONSTRAINT "project_certificates_period_ordered" CHECK (
		"period_from" IS NULL OR "period_to" IS NULL
		OR "period_to" >= "period_from"
	),
	-- The same biconditional as an awarded bill and an approved budget, and
	-- against `draft` rather than against `certified` so a CANCELLED certificate
	-- that was once issued keeps its stamp.
	CONSTRAINT "project_certificates_draft_is_uncertified" CHECK (
		("status" = 'draft') = ("certified_at" IS NULL)
	),
	CONSTRAINT "project_certificates_certifier_pair" CHECK (
		("certified_at" IS NULL)
		= (length(btrim(COALESCE("certified_by_name", ''))) = 0)
	)
);
--> statement-breakpoint

ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_certified_by_id_users_id_fk" FOREIGN KEY ("certified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- A CERTIFICATE BELONGS TO ITS CONTRACT'S PROJECT. A plain foreign key cannot
-- say that, and a certificate valued against one project's bill and settled
-- under another's contract is wrong in a way no screen would show. Same
-- composite technique as 0071 and 0076.
ALTER TABLE "project_certificates" ADD CONSTRAINT "project_certificates_contract_same_project_fk" FOREIGN KEY ("contract_id","project_id") REFERENCES "public"."project_contracts"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_certificates_sequence_uq" ON "project_certificates" USING btree ("contract_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "project_certificates_number_uq" ON "project_certificates" USING btree ("company_id","certificate_number");--> statement-breakpoint
-- Decision 8: two half-made drafts on one contract is two people preparing the
-- same valuation without knowing it.
CREATE UNIQUE INDEX "project_certificates_one_draft" ON "project_certificates" USING btree ("contract_id") WHERE "project_certificates"."status" = 'draft';--> statement-breakpoint
-- One certificate per invoice: a draft raised twice would be billed twice.
CREATE UNIQUE INDEX "project_certificates_invoice_uq" ON "project_certificates" USING btree ("invoice_id") WHERE "invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_certificates_project_idx" ON "project_certificates" USING btree ("company_id","project_id","valuation_date");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A certified certificate is frozen (decision 8).
--
-- Same shape as `project_budget_lines_frozen` (0070) and
-- `project_boq_items_frozen` (0076), including the arm that lets a cascade
-- through. `notes` and `invoice_id` are NOT frozen: recording which invoice was
-- raised against a certificate happens after it is certified, by definition,
-- and a note is not a figure.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_certificates_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.work_done_to_date          IS NOT DISTINCT FROM OLD.work_done_to_date
     AND NEW.materials_on_site      IS NOT DISTINCT FROM OLD.materials_on_site
     AND NEW.dayworks_to_date       IS NOT DISTINCT FROM OLD.dayworks_to_date
     AND NEW.retention_released_to_date
                                    IS NOT DISTINCT FROM OLD.retention_released_to_date
     AND NEW.valuation_date         IS NOT DISTINCT FROM OLD.valuation_date
     AND NEW.period_from            IS NOT DISTINCT FROM OLD.period_from
     AND NEW.period_to              IS NOT DISTINCT FROM OLD.period_to
     AND NEW.sequence               IS NOT DISTINCT FROM OLD.sequence
     AND NEW.contract_id            IS NOT DISTINCT FROM OLD.contract_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Certificate % has been issued and its figures cannot be changed. Correct it on the next certificate — the arithmetic is cumulative.',
    NEW.certificate_number
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_certificates_frozen"
BEFORE UPDATE ON "project_certificates"
FOR EACH ROW EXECUTE FUNCTION project_certificates_frozen();--> statement-breakpoint

-- An issued certificate is not deleted. It is what somebody was asked to pay
-- against, and a payment may already refer to the invoice it raised.
CREATE OR REPLACE FUNCTION project_certificates_no_delete_issued() RETURNS trigger AS $$
BEGIN
  -- The contract or the project is going: this is the cascade, not a deletion.
  IF NOT EXISTS (SELECT 1 FROM project_contracts c WHERE c.id = OLD.contract_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'Certificate % has been issued and cannot be deleted. Cancel it instead.',
      OLD.certificate_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_certificates_no_delete_issued"
BEFORE DELETE ON "project_certificates"
FOR EACH ROW EXECUTE FUNCTION project_certificates_no_delete_issued();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_contracts', 'project_certificates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_contracts" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_certificates" TO app_user;
