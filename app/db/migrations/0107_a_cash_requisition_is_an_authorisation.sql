-- ─────────────────────────────────────────────────────────────────────────────
-- 0107 — The cash requisition, and it is an AUTHORISATION rather than a
--        movement of money.
--
-- The last section of the Projects module with no record behind it.
-- `PROJECTS-QALITRACK-PLAN.md` §11 left it deliberately: "Cash Requisitions is
-- untouched. It remains a view over claims and expenses, and it is the next
-- thing that deserves a record of its own — as a forecast, not as a small
-- certificate." This is that record.
--
-- ── Decision 1 — IT POSTS NOTHING, AND THAT IS THE WHOLE DESIGN ────────────
--
-- Every ERP that runs construction draws the same line. SAP has no cash
-- requisition object at all: a purchase requisition authorises goods, a cash
-- advance authorises a person, the cash journal runs the site tin. Oracle and
-- NetSuite split it the same way. Sage 300 CRE, Viewpoint and CMiC keep job
-- cost and commitments and settle site cash through an imprest float. RIB
-- BuildSmart — the one most of this market has actually used — has site
-- requisitions, and they FEED procurement or the cash book rather than being
-- either.
--
-- A requisition authorises; the money moves on a path that already exists.
--
-- And in this app three such paths are already built and already post:
--
--   * `employee_claims` — advance request, paid, settled, unspent cash
--     returned. That is an imprest, for a person.
--   * `petty_cash_returns` and its float accounts — funding posts
--     DR Petty Cash / CR Bank (0060). That is an imprest, for a tin.
--   * `stock_requests` — which already carry `project_number_at_request` and
--     `cost_code_at_request`. That is the goods path.
--
-- A fourth path that posted its own journal would put the same 6,400,000 in
-- the ledger twice: once as the requisition, again as the advance or the
-- expense it becomes. It is the rule the timesheet decision already used —
-- labour reaches the GL once, through payroll, and counting both charges the
-- job twice (0089 decision 4).
--
-- So `funded_source` and `funded_source_id` record WHICH existing document
-- released the money, exactly as `project_certificates.invoice_id` records the
-- invoice a certificate raised. Nothing here writes to `journal_lines`.
--
-- ── Decision 2 — ONE AMOUNT, ONE PURPOSE, ONE COST CODE ────────────────────
--
-- The MD's own form (`QaliTrack_PMS`) is a single row: CR number, date,
-- requested by, category, purpose, amount, status. Not a multi-line forecast.
-- Building lines he did not ask for would be a table to maintain and a form to
-- fill for a request that is usually "fuel for the week, 180,000".
--
-- The one field raised from his sketch is CATEGORY: it becomes a `cost_code_id`
-- rather than free text. Cost codes already exist, are configured per tenant,
-- and are what the budget is built from — so the same badge on the same screen
-- now also means the request can be read against what the job allowed for.
-- `cost_code_at_request` is the snapshot beside it, the same idiom
-- `stock_requests` and `employee_claims` already use: a code renamed next year
-- must not rewrite what this request was coded to.
--
-- If multi-line requisitions are ever wanted, they are a child table added
-- later. Nothing about the money story changes, which is the point of keeping
-- this one thin.
--
-- ── Decision 3 — APPROVED IS THE POINT IT COUNTS ───────────────────────────
--
-- draft → submitted → approved → funded, with rejected and cancelled off the
-- side. The same rule 0088 put bills, claims and expenses on, 0089 put
-- timesheets on, and 0091 put variations on: a submitted requisition is a
-- request, and only an approved one may be funded.
--
-- The figures freeze at APPROVAL, not at submission. Before that it is a
-- request under discussion and the site should be able to correct it without a
-- recall; after it, the amount is what somebody authorised and changing it
-- silently changes what was agreed.
--
-- ── Decision 4 — A DECISION CARRIES A NAME, AND A REFUSAL CARRIES A REASON ─
--
-- Approving, rejecting or funding without `decided_by_name` and `decided_at`
-- is a checkbox rather than a decision — the same constraint
-- `project_instructions_response_signed` makes (0075). A rejection also needs
-- ten characters of reason, which is the rule `employee_claims` already
-- enforces: "no" with no grounds is not an answer a site can act on.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "project_cash_requisition_status" AS ENUM (
  'draft', 'submitted', 'approved', 'rejected', 'funded', 'cancelled'
);--> statement-breakpoint

-- What released the money. `other` is honest rather than lax: cash handed over
-- against a signature outside any of the three paths happens, and recording it
-- as `other` is better than recording it as a petty cash return that does not
-- exist.
CREATE TYPE "project_cash_requisition_source" AS ENUM (
  'employee_advance', 'petty_cash', 'stock_request', 'other'
);--> statement-breakpoint

CREATE TABLE "project_cash_requisitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,

  -- 'CRQ' through the shared counter from 0001. It needs no registration: the
  -- function creates the counter row on first use, the same way 'EI' and 'CSD'
  -- did in 0075.
  "requisition_number" text NOT NULL,

  "request_date" date DEFAULT CURRENT_DATE NOT NULL,
  -- When the site needs it by. Nullable: plenty of requests are "as soon as
  -- you can", and a made-up date is worse than none.
  "needed_by" date,

  -- Decision 2.
  "cost_code_id" uuid,
  "cost_code_at_request" text,

  "purpose" text NOT NULL,
  "amount" numeric(19, 4) NOT NULL,

  "status" "project_cash_requisition_status" DEFAULT 'draft' NOT NULL,

  "requested_by_id" text,
  "requested_by_name" text NOT NULL,

  "decided_by_id" text,
  "decided_by_name" text,
  "decided_at" timestamp with time zone,
  "decision_notes" text,

  -- Decision 1: which existing document released the money.
  "funded_source" "project_cash_requisition_source",
  "funded_source_id" uuid,
  "funded_at" timestamp with time zone,

  "notes" text DEFAULT '' NOT NULL,

  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "project_cash_requisitions_purpose_not_blank"
    CHECK (length(btrim("purpose")) > 0),
  CONSTRAINT "project_cash_requisitions_requester_named"
    CHECK (length(btrim("requested_by_name")) > 0),
  -- Zero is not a request, and a negative one is a refund by another name.
  CONSTRAINT "project_cash_requisitions_amount_positive"
    CHECK ("amount" > 0),

  -- Decision 4. Written as a conditional on the STATUS rather than as an
  -- equivalence: a draft may carry neither, and a decided row must carry both.
  CONSTRAINT "project_cash_requisitions_decision_signed"
    CHECK ("status" NOT IN ('approved', 'rejected', 'funded')
           OR ("decided_by_name" IS NOT NULL AND "decided_at" IS NOT NULL)),
  CONSTRAINT "project_cash_requisitions_rejection_reasoned"
    CHECK ("status" <> 'rejected'
           OR ("decision_notes" IS NOT NULL
               AND length(btrim("decision_notes")) >= 10)),

  -- A pair CHECK needs both columns or neither, and the SOURCE is the half
  -- that may stand alone: money released outside the three paths is recorded
  -- as `other` with no id. An id without a source is the nonsense case.
  CONSTRAINT "project_cash_requisitions_source_pair"
    CHECK ("funded_source_id" IS NULL OR "funded_source" IS NOT NULL),
  CONSTRAINT "project_cash_requisitions_funded_dated"
    CHECK (("status" = 'funded') = ("funded_at" IS NOT NULL)),

  -- The snapshot follows the id, the same pair rule the project and cost code
  -- columns on stock_requests and claims carry.
  CONSTRAINT "project_cash_requisitions_cost_code_pair"
    CHECK ("cost_code_id" IS NULL OR "cost_code_at_request" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "project_cash_requisitions" ADD CONSTRAINT "project_cash_requisitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cash_requisitions" ADD CONSTRAINT "project_cash_requisitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `set null` rather than cascade: deleting a cost code must not delete the
-- requests coded to it, and `cost_code_at_request` is why they stay readable.
ALTER TABLE "project_cash_requisitions" ADD CONSTRAINT "project_cash_requisitions_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cash_requisitions" ADD CONSTRAINT "project_cash_requisitions_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cash_requisitions" ADD CONSTRAINT "project_cash_requisitions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cash_requisitions" ADD CONSTRAINT "project_cash_requisitions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The register reads one project, newest first; the alert badge counts what is
-- waiting on somebody, which is the same index.
CREATE UNIQUE INDEX "project_cash_requisitions_number_uq" ON "project_cash_requisitions" USING btree ("company_id","requisition_number");--> statement-breakpoint
CREATE INDEX "project_cash_requisitions_register_idx" ON "project_cash_requisitions" USING btree ("project_id","status","request_date");--> statement-breakpoint
CREATE INDEX "project_cash_requisitions_company_idx" ON "project_cash_requisitions" USING btree ("company_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 3 — the state machine, and the freeze that comes with approval.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_cash_requisitions_transition() RETURNS trigger AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_ok := CASE OLD.status
              WHEN 'draft'     THEN NEW.status IN ('submitted', 'cancelled')
              -- Back to draft is the requester recalling their own request,
              -- which the claims module learned to allow the hard way.
              WHEN 'submitted' THEN NEW.status IN ('approved', 'rejected', 'draft', 'cancelled')
              WHEN 'approved'  THEN NEW.status IN ('funded', 'cancelled')
              WHEN 'rejected'  THEN NEW.status IN ('submitted', 'cancelled')
              ELSE false
            END;

    IF NOT v_ok THEN
      RAISE EXCEPTION
        'A cash requisition cannot go from % to %.', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Frozen from approval onward. The status column is excluded on purpose:
  -- this is what a requisition WAS AUTHORISED FOR, and funding or cancelling
  -- it must still be possible.
  IF OLD.status IN ('approved', 'funded') THEN
    IF NEW.amount       IS DISTINCT FROM OLD.amount
       OR NEW.purpose      IS DISTINCT FROM OLD.purpose
       OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
       OR NEW.request_date IS DISTINCT FROM OLD.request_date THEN
      RAISE EXCEPTION
        'Requisition % was approved for % — its amount, purpose, cost code and date can no longer change. Cancel it and raise another.',
        OLD.requisition_number, to_char(OLD.amount, 'FM999,999,999,990.00')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_cash_requisitions_transition"
BEFORE UPDATE ON "project_cash_requisitions"
FOR EACH ROW EXECUTE FUNCTION project_cash_requisitions_transition();--> statement-breakpoint

-- A cost code belongs to the tenant, and where it names a project it must name
-- THIS one — the same check `project_budget_lines` makes. A company-wide code
-- (project_id IS NULL) is available to every job.
CREATE OR REPLACE FUNCTION project_cash_requisitions_cost_code_fits() RETURNS trigger AS $$
DECLARE
  v_project uuid;
  v_company uuid;
BEGIN
  IF NEW.cost_code_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cc.project_id, cc.company_id INTO v_project, v_company
    FROM project_cost_codes cc WHERE cc.id = NEW.cost_code_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That cost code does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_company <> NEW.company_id THEN
    RAISE EXCEPTION 'That cost code belongs to another company.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_project IS NOT NULL AND v_project <> NEW.project_id THEN
    RAISE EXCEPTION 'That cost code belongs to a different project.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_cash_requisitions_cost_code_fits"
BEFORE INSERT OR UPDATE OF cost_code_id, project_id
ON "project_cash_requisitions"
FOR EACH ROW EXECUTE FUNCTION project_cash_requisitions_cost_code_fits();--> statement-breakpoint

-- An issued requisition is not deleted. Somebody was asked for money against
-- it, and on an approved one somebody released it.
CREATE OR REPLACE FUNCTION project_cash_requisitions_no_delete_issued() RETURNS trigger AS $$
BEGIN
  -- The project is going: this is the cascade, not a deletion.
  IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'Requisition % is %, not a draft — cancel it instead of deleting it.',
      OLD.requisition_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_cash_requisitions_no_delete_issued"
BEFORE DELETE ON "project_cash_requisitions"
FOR EACH ROW EXECUTE FUNCTION project_cash_requisitions_no_delete_issued();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_cash_requisitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_cash_requisitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_cash_requisitions"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_cash_requisitions" TO app_user;
