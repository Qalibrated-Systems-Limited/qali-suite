-- ─────────────────────────────────────────────────────────────────────────────
-- 0091 — The variation register, and the end of a contract sum that cannot move.
--
-- Step 3 of `docs/PROJECTS-EXECUTION-LAYER.md` §4 and step 4 of the QaliTrack
-- plan's sequence, and the single thing standing between this module and a
-- FIDIC-form contract.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- `project_contracts.contract_sum` was typed once and had nothing that could
-- ever change it. So from the FIRST variation:
--
--   * the contract sum on the IPC page is wrong,
--   * "% of contract certified" — which is on that page, in front of the
--     person deciding whether to certify — is wrong,
--   * `project_instructions.estimated_cost` has been collected since 0075 and
--     fed nothing at all, and
--   * there is no register to answer "what were we instructed to do, what did
--     it cost, and what did it do to the completion date" — which is the whole
--     of an extension-of-time argument, and the whole of a final account.
--
-- Procore, Candy and SAP all have this register. It is not a refinement.
--
-- ── Decision 1 — THE ORIGINAL IS KEPT, AND THE CURRENT IS DERIVED ──────────
--
-- `original_sum` already existed and was already immutable — 0081 set it at
-- creation and `updateContract` refuses to touch it. This makes the other half
-- true as well: `contract_sum` is no longer typed, it is
--
--     original_sum + Σ(approved variations)
--
-- computed by trigger. That is the only arrangement where the two figures
-- cannot disagree, and "how much has this contract grown" is answerable
-- without anybody maintaining a second number by hand.
--
-- The terms form now edits `original_sum` — the figure the contract was LET
-- at. A user who types a new contract sum after three approved variations was,
-- under the old behaviour, silently overwriting the variations' effect.
--
-- ── Decision 2 — TIME MOVES THE SAME WAY, AND NEEDS ITS OWN ORIGINAL ───────
--
-- A variation carries `time_effect_days` beside its cost, because an
-- instruction that adds four weeks and no money is the commonest kind there
-- is. So `original_completion_date` joins `original_sum`, and
--
--     completion_date = original_completion_date + Σ(approved time effects)
--
-- Without the original, "when was this contract due to finish" has no answer
-- after the first EOT, and that is the question every delay claim starts with.
--
-- ── Decision 3 — ONLY AN APPROVED VARIATION MOVES ANYTHING ─────────────────
--
-- draft → submitted → approved, and rejected off the side. A submitted
-- variation is a claim, not a change: the register shows it, the contract sum
-- does not. This is the same "approved is the point it counts" rule 0088 put
-- bills, claims and expenses on, and 0089 put timesheets on.
--
-- A NEGATIVE COST EFFECT IS LEGITIMATE. An omission is a variation like any
-- other and reduces the sum; so is a negative time effect on an acceleration.
-- What is refused is a variation with NEITHER a cost nor a time effect, which
-- is a note rather than a variation.
--
-- ── Decision 4 — IT LINKS TO THE INSTRUCTION IT CAME FROM ──────────────────
--
-- `instruction_id`, nullable. A variation normally begins as an engineer's
-- instruction, and the register is far more useful when it can show which.
-- Nullable because it does not always: a contractor-initiated variation, or
-- one agreed at a site meeting, has no EI behind it.
--
-- `set null` on delete, not cascade — deleting an instruction must not delete
-- the money that followed from it.
--
-- ── Decision 5 — NOTHING HERE POSTS ────────────────────────────────────────
--
-- A variation changes what the contract is worth. It does not change what has
-- been earned, and the ledger records what has been earned. The money reaches
-- the books the same way it always did: through a certificate, which values
-- the work actually done — including the varied work — and raises an invoice.
--
-- A variation that posted would book revenue on an instruction nobody has
-- carried out yet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "project_variation_status" AS ENUM ('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint

-- ── The original completion date ────────────────────────────────────────────
-- Backfilled from the current one: before this migration nothing could move
-- it, so what is there IS the original.
ALTER TABLE "project_contracts"
  ADD COLUMN "original_completion_date" date;--> statement-breakpoint

UPDATE "project_contracts"
   SET "original_completion_date" = "completion_date"
 WHERE "original_completion_date" IS NULL;--> statement-breakpoint

-- ── And the original sum, made true before it starts deriving from it ───────
--
-- `original_sum` was set at creation and `updateContract` never moved it, but
-- `contract_sum` WAS editable — so a contract whose sum was corrected after
-- creation has the two out of step. Deriving `contract_sum` from `original_sum`
-- without this would silently REVERT that correction on the first variation.
--
-- There are no variations yet, by definition, so the current sum is the whole
-- truth and becomes the original. This runs once and cannot run again wrongly.
UPDATE "project_contracts"
   SET "original_sum" = "contract_sum"
 WHERE "original_sum" <> "contract_sum";--> statement-breakpoint

CREATE TABLE "project_variations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,

  -- VO-00001, from `next_entry_number` — the same race-free counter every
  -- other numbered document in this schema uses.
  "variation_number" text NOT NULL,

  -- The engineer's instruction this came from, where there was one.
  "instruction_id" uuid,

  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,

  -- Both may be negative: an omission reduces the sum, an acceleration
  -- reduces the time.
  "cost_effect" numeric(19, 4) DEFAULT '0' NOT NULL,
  "time_effect_days" integer DEFAULT 0 NOT NULL,

  "status" "project_variation_status" DEFAULT 'draft' NOT NULL,
  "issued_date" date NOT NULL,
  "reference" text,
  "notes" text DEFAULT '' NOT NULL,

  "submitted_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "decided_by_id" text,
  "decided_by_name" text,
  "decision_notes" text,

  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "project_variations_title_not_blank"
    CHECK (length(btrim("title")) > 0),

  -- A variation with no effect on either the money or the time is a note.
  CONSTRAINT "project_variations_has_an_effect"
    CHECK ("cost_effect" <> 0 OR "time_effect_days" <> 0),

  -- Decided means somebody decided it, and the reverse — the same
  -- biconditional the budget approval and the certificate carry.
  CONSTRAINT "project_variations_decision_pair"
    CHECK (("status" IN ('approved', 'rejected')) = ("decided_at" IS NOT NULL)),
  CONSTRAINT "project_variations_decider_named"
    CHECK ("decided_at" IS NULL OR "decided_by_name" IS NOT NULL),
  CONSTRAINT "project_variations_submission_pair"
    CHECK ("status" = 'draft' OR "submitted_at" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "project_variations" ADD CONSTRAINT "project_variations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variations" ADD CONSTRAINT "project_variations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variations" ADD CONSTRAINT "project_variations_contract_id_project_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."project_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `set null`: deleting an instruction must not delete the money that followed.
ALTER TABLE "project_variations" ADD CONSTRAINT "project_variations_instruction_id_project_instructions_id_fk" FOREIGN KEY ("instruction_id") REFERENCES "public"."project_instructions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variations" ADD CONSTRAINT "project_variations_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variations" ADD CONSTRAINT "project_variations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_variations_number_uq" ON "project_variations" USING btree ("company_id","variation_number");--> statement-breakpoint
CREATE INDEX "project_variations_register_idx" ON "project_variations" USING btree ("project_id","status","issued_date");--> statement-breakpoint
CREATE INDEX "project_variations_contract_idx" ON "project_variations" USING btree ("contract_id","status");--> statement-breakpoint
CREATE INDEX "project_variations_instruction_idx" ON "project_variations" USING btree ("instruction_id") WHERE "instruction_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 1 and 2 — the current figures are derived, on the contract itself.
--
-- BEFORE, so it writes NEW rather than issuing an UPDATE — a contract trigger
-- that updated `project_contracts` would call itself.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_contracts_derive_current() RETURNS trigger AS $$
DECLARE
  v_cost numeric := 0;
  v_days integer := 0;
BEGIN
  SELECT COALESCE(SUM(v.cost_effect), 0), COALESCE(SUM(v.time_effect_days), 0)
    INTO v_cost, v_days
    FROM project_variations v
   WHERE v.contract_id = NEW.id
     AND v.status = 'approved';

  NEW.contract_sum := NEW.original_sum + v_cost;

  -- A contract with no completion date stays without one; a variation cannot
  -- invent a programme nobody set.
  IF NEW.original_completion_date IS NOT NULL THEN
    NEW.completion_date := NEW.original_completion_date + v_days;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_contracts_derive_current"
BEFORE INSERT OR UPDATE ON "project_contracts"
FOR EACH ROW EXECUTE FUNCTION project_contracts_derive_current();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- And a variation nudges its contract, which recomputes itself above.
--
-- One UPDATE that changes only `updated_at`; the BEFORE trigger does the work.
-- Keeping the arithmetic in ONE function is the point — two copies of
-- "original plus the approved ones" is two copies that will disagree.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_variations_touch_contract() RETURNS trigger AS $$
DECLARE
  v_contract uuid;
BEGIN
  v_contract := COALESCE(NEW.contract_id, OLD.contract_id);
  UPDATE project_contracts SET updated_at = now() WHERE id = v_contract;

  -- A variation moved between contracts has to settle the one it left, too.
  IF TG_OP = 'UPDATE' AND OLD.contract_id IS DISTINCT FROM NEW.contract_id THEN
    UPDATE project_contracts SET updated_at = now() WHERE id = OLD.contract_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_variations_touch_contract"
AFTER INSERT OR UPDATE OF cost_effect, time_effect_days, status, contract_id
   OR DELETE
ON "project_variations"
FOR EACH ROW EXECUTE FUNCTION project_variations_touch_contract();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A variation belongs to its own project's contract, and to its own project's
-- instruction. Neither is expressible as a plain foreign key.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_variations_belong_together() RETURNS trigger AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT c.project_id INTO v_project
    FROM project_contracts c WHERE c.id = NEW.contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That contract does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_project <> NEW.project_id THEN
    RAISE EXCEPTION 'That contract belongs to a different project.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.instruction_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM project_instructions i
                      WHERE i.id = NEW.instruction_id
                        AND i.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'That instruction belongs to a different project.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_variations_belong_together"
BEFORE INSERT OR UPDATE OF contract_id, instruction_id, project_id
ON "project_variations"
FOR EACH ROW EXECUTE FUNCTION project_variations_belong_together();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_variations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_variations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_variations"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_variations" TO app_user;
