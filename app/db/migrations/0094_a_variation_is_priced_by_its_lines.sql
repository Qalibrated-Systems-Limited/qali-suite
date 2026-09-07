-- ─────────────────────────────────────────────────────────────────────────────
-- 0094 — A variation is priced by its lines, not typed as a lump sum.
--
-- 0091 gave the contract sum something that could move it and left the movement
-- as ONE TYPED FIGURE. That is enough to keep the sum honest and not enough to
-- defend it: at a final account "the contract grew by 2.4m" is not an answer,
-- and neither is a register of eleven such sentences.
--
-- ── A variation is one of three things, and only one of them is a reference ─
--
--   an OMISSION of work that is in the bill      — a negative quantity at the
--                                                   bill's own rate
--   a REMEASURE of work that is in the bill      — more or less of an item
--   NEW WORK that was never in the bill          — its own description, unit
--                                                   and rate, agreed for this
--                                                   variation
--
-- A single `boq_item_id` on the variation covers the first two and cannot
-- express the third, which is the commonest of them. So the link is a LINE,
-- and `boq_item_id` on the line is NULLABLE: null means new work.
--
-- ── Decision 1 — THE LINE IS SELF-CONTAINED, AND THE LINK IS PROVENANCE ────
--
-- A line carries its own description, unit, quantity and rate. When it is
-- raised against a bill item the repository copies that item's description,
-- unit and rate as the starting point and keeps `boq_item_id` as the record of
-- where it came from.
--
-- Not read through to the bill on every render, for the reason every `*_at_*`
-- column in this schema exists: a bill can be superseded by a new version, and
-- an agreed variation must not be repriced by a document raised after it was
-- agreed. Same rule as `account_code_at_budget`, and as the certificate
-- snapshot in 0092.
--
-- ── Decision 2 — THE AMOUNT IS THE DATABASE'S ─────────────────────────────
--
-- `amount = quantity × rate`, written by trigger and never typed. A line whose
-- amount disagrees with its own quantity and rate is the single most common
-- defect in a hand-built variation account.
--
-- A NEGATIVE QUANTITY IS ORDINARY. It is how an omission is written on every
-- bill, and 0091 already accepts a negative `cost_effect`. The rate stays
-- positive; the quantity carries the sign.
--
-- ── Decision 3 — WHERE THERE ARE LINES, THEY ARE THE COST EFFECT ──────────
--
-- `project_variations.cost_effect` becomes the sum of its lines the moment it
-- has any, by trigger, and `contract_sum` follows through 0091's own chain
-- without anything new. Two places holding the same figure is two places that
-- will disagree — the mistake 0070's cached `financials` made, and the reason
-- 0091 derives the contract sum rather than storing it twice.
--
-- REMOVING THE LAST LINE LEAVES THE FIGURE WHERE IT IS rather than zeroing it.
-- Zeroing would trip `project_variations_has_an_effect` on a variation whose
-- effect is entirely a time one, and a variation returning to a lump sum is a
-- legitimate thing to do — the figure it returns to is the one its lines came
-- to, which is the only defensible starting point.
--
-- ── Decision 4 — AN APPROVED VARIATION'S LINES ARE FROZEN ─────────────────
--
-- Its figures are in the contract sum and in every certificate's percentage
-- since. 0091 refuses to amend an approved variation; a line is the same
-- figure one level down, and refusing there too is what stops the guard being
-- decorative.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "project_variation_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "variation_id" uuid NOT NULL,

  -- NULL is NEW WORK — the commonest kind of variation line, and the one a
  -- reference to the bill cannot express.
  "boq_item_id" uuid,

  "item_code" text,
  "description" text NOT NULL,
  "unit" text,
  -- Signed: negative is an omission, which is how it is written on a bill.
  "quantity" numeric(19, 4) DEFAULT '0' NOT NULL,
  "rate" numeric(19, 4) DEFAULT '0' NOT NULL,
  -- Decision 2 — written by trigger, never typed.
  "amount" numeric(19, 4) DEFAULT '0' NOT NULL,

  "sequence" integer DEFAULT 0 NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "project_variation_items_description_not_blank"
    CHECK (length(btrim("description")) > 0),
  -- The quantity carries the sign; a negative RATE is a typing error.
  CONSTRAINT "project_variation_items_rate_non_negative"
    CHECK ("rate" >= 0)
);--> statement-breakpoint

ALTER TABLE "project_variation_items" ADD CONSTRAINT "project_variation_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variation_items" ADD CONSTRAINT "project_variation_items_variation_id_project_variations_id_fk" FOREIGN KEY ("variation_id") REFERENCES "public"."project_variations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `set null`: superseding a bill must not delete the priced variation lines
-- raised against it. The line keeps its own figures; only the provenance goes.
ALTER TABLE "project_variation_items" ADD CONSTRAINT "project_variation_items_boq_item_id_project_boq_items_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."project_boq_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "project_variation_items_variation_idx" ON "project_variation_items" USING btree ("variation_id","sequence");--> statement-breakpoint
CREATE INDEX "project_variation_items_boq_item_idx" ON "project_variation_items" USING btree ("boq_item_id") WHERE "boq_item_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 2 — the amount, and Decision 4 — an approved variation is closed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_variation_items_derive() RETURNS trigger AS $$
DECLARE
  v_status project_variation_status;
  v_project uuid;
BEGIN
  SELECT v.status INTO v_status
    FROM project_variations v WHERE v.id = NEW.variation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That variation does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_status = 'approved' THEN
    RAISE EXCEPTION
      'That variation is approved and its figures are in the contract sum. Reject it and raise another.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A line raised against the bill must be against THIS project's bill.
  IF NEW.boq_item_id IS NOT NULL THEN
    SELECT i.project_id INTO v_project
      FROM project_boq_items i WHERE i.id = NEW.boq_item_id;

    IF v_project IS DISTINCT FROM (
      SELECT v.project_id FROM project_variations v WHERE v.id = NEW.variation_id
    ) THEN
      RAISE EXCEPTION 'That bill item belongs to a different project.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.amount := ROUND(NEW.quantity * NEW.rate, 4);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_variation_items_derive"
BEFORE INSERT OR UPDATE ON "project_variation_items"
FOR EACH ROW EXECUTE FUNCTION project_variation_items_derive();--> statement-breakpoint

-- A DELETE has no NEW row, so the approval guard needs its own arm.
CREATE OR REPLACE FUNCTION project_variation_items_deletable() RETURNS trigger AS $$
DECLARE
  v_status project_variation_status;
BEGIN
  SELECT v.status INTO v_status
    FROM project_variations v WHERE v.id = OLD.variation_id;

  -- The variation itself going away takes its lines with it, and that arm must
  -- not fight the cascade.
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  IF v_status = 'approved' THEN
    RAISE EXCEPTION
      'That variation is approved and its figures are in the contract sum. Reject it and raise another.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_variation_items_deletable"
BEFORE DELETE ON "project_variation_items"
FOR EACH ROW EXECUTE FUNCTION project_variation_items_deletable();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 3 — where there are lines, they ARE the cost effect.
--
-- `project_variations_touch_contract` then fires on the cost_effect UPDATE and
-- 0091's chain recomputes the contract sum. Nothing new is needed for that.
--
-- Removing the LAST line leaves the figure where it stands: zeroing it would
-- trip `project_variations_has_an_effect` on a time-only variation, and the
-- sum its lines came to is the only defensible lump sum to fall back to.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_variation_items_price_the_variation() RETURNS trigger AS $$
DECLARE
  v_variation uuid;
  v_total     numeric;
  v_lines     integer;
BEGIN
  v_variation := COALESCE(NEW.variation_id, OLD.variation_id);

  SELECT COALESCE(SUM(i.amount), 0), COUNT(*)
    INTO v_total, v_lines
    FROM project_variation_items i
   WHERE i.variation_id = v_variation;

  IF v_lines > 0 THEN
    UPDATE project_variations
       SET cost_effect = v_total, updated_at = now()
     WHERE id = v_variation
       AND cost_effect IS DISTINCT FROM v_total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_variation_items_price_the_variation"
AFTER INSERT OR UPDATE OF quantity, rate, amount, variation_id OR DELETE
ON "project_variation_items"
FOR EACH ROW EXECUTE FUNCTION project_variation_items_price_the_variation();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_variation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_variation_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_variation_items"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_variation_items" TO app_user;
