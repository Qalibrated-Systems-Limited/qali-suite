-- ============================================================================
-- 0051 — Procurement: what was wrong with the goods.
--
-- The last of the three procurement migrations. §9G scoped nonconformance in
-- with the receipt rather than as a vertical of its own, on the grounds that
-- "the NCR is a rejection of received goods, so it belongs with the receipt —
-- and rejecting must reverse the inventory side, not merely record an opinion."
--
-- Reading closeNCR (ncr-actions.js:357) showed that is understated. It moves
-- the goods out of HOLD correctly, and then:
--
--     NOTE: journal-entry posting for return/scrap (supplier debit-note /
--     write-off) is intentionally out of scope here — separate ledger work.
--
-- So goods are scrapped or shipped back to the supplier, they physically leave
-- stock, and NOTHING REACHES THE LEDGER. Inventory on the balance sheet still
-- carries their value. That is a different fault from the four modules in §9G
-- — those post to the wrong store; this one does not post at all — but it is
-- the same hole in the same books, and it is in scope for the same reason.
-- `journal_entry_id` below is where the write-off lands.
--
-- ── Three decisions ─────────────────────────────────────────────────────────
--
-- 1. AN NCR LINE POINTS AT THE RECEIPT LINE IT IS ABOUT.
--    closeNCR builds `ncrByProduct`, a Map keyed on product id, and matches
--    GRN lines to NCR lines through it. It is the third place in this module
--    that matches documents by product (postGRNAcceptanceJournal does it for
--    bill lines, acceptGRN for PO lines), and it fails the same way: a receipt
--    with two lines of the same product — two pallets, two conditions, which
--    is the ORDINARY case for a nonconformance — silently resolves against
--    whichever line the map happened to keep.
--
--    `goods_receipt_line_id` is a foreign key. There is nothing to match.
--
-- 2. THE NCR AND ACCEPTANCE DO NOT RACE FOR THE RECEIPT LINE.
--    closeNCR sets `gline.lineStatus` and `gline.acceptedQty` on the goods
--    receipt, which acceptGRN also sets, and the comment concedes the outcome:
--    "whichever side runs first wins, the other no-ops on those lines". Two
--    workflows owning one field, arbitrated by an `inventoryApplied` boolean.
--
--    Here the two are ORDERED rather than arbitrated. Acceptance decides every
--    line it can and explicitly DEFERS the rest by finalising them as 'hold' —
--    on hand, on hold, unissuable, and unbought, with no Inventory debit
--    raised for them. The NCR is then the only thing that can resolve such a
--    line, and 0050's trigger enforces exactly that: a held line on a finalised
--    receipt may move out of 'hold', in that direction only, and nothing else
--    about it may change. There is no first-wins, because there is no second.
--
-- 3. IMPACT IS DERIVED WHERE IT IS KNOWABLE.
--    `estimatedImpact` is a single typed number on the header. For a
--    GRN-sourced NCR the real figure is not an estimate at all — the receipt
--    lines carry the unit cost and the quantity — so `nonconformance_state`
--    derives it. The typed field stays for the sources where nobody can
--    compute it (a tool returned damaged, a count variance), which is what it
--    was actually for.
-- ============================================================================

ALTER TYPE "public"."source_document_type"
  ADD VALUE IF NOT EXISTS 'nonconformance';--> statement-breakpoint

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "ncr_prefix" text NOT NULL DEFAULT 'NCR';--> statement-breakpoint

CREATE OR REPLACE FUNCTION document_prefix(p_company_id uuid, p_kind text)
RETURNS text AS $$
DECLARE
  v_prefix text;
BEGIN
  SELECT CASE p_kind
           WHEN 'invoice' THEN s.invoice_prefix
           WHEN 'bill'    THEN s.bill_prefix
           WHEN 'quote'   THEN s.quote_prefix
           WHEN 'po'      THEN s.po_prefix
           WHEN 'grn'     THEN s.grn_prefix
           WHEN 'ncr'     THEN s.ncr_prefix
         END
    INTO v_prefix
    FROM company_settings s
   WHERE s.company_id = p_company_id;

  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := CASE p_kind
                  WHEN 'invoice' THEN 'INV'
                  WHEN 'bill'    THEN 'BILL'
                  WHEN 'quote'   THEN 'QT'
                  WHEN 'po'      THEN 'PO'
                  WHEN 'grn'     THEN 'GRN'
                  WHEN 'ncr'     THEN 'NCR'
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TABLE "nonconformances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "ncr_number" text NOT NULL,

  "category" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',

  -- Where it came from. `goods_receipt_id` is the only source this migration
  -- can make a foreign key — stock counts and tool returns are not ported
  -- (§10), so those carry the reference the way bills carried theirs, and the
  -- FK lands with the table.
  "source_type" text NOT NULL,
  "goods_receipt_id" uuid,
  "stock_count_id" uuid,
  "tool_return_id" uuid,
  "source_reference" text,

  "supplier_id" uuid,
  "supplier_name" text,

  "title" text NOT NULL,
  "description" text NOT NULL,
  "photo_urls" text[] NOT NULL DEFAULT '{}',

  -- Decision 3: an estimate, for the sources where the figure cannot be
  -- computed. GRN-sourced NCRs derive theirs — see nonconformance_state.
  "estimated_impact" numeric(19,4),

  -- ── Disposition (SOP §10.6) ────────────────────────────────────────────
  "disposition_type" text NOT NULL DEFAULT 'pending',
  "disposition_reason" text,
  "proposed_by_id" text,
  "proposed_by_name" text,
  "proposed_at" timestamp with time zone,
  "authorized_by_id" text,
  "authorized_by_name" text,
  "authorized_at" timestamp with time zone,
  "authorization_notes" text,
  "executed_at" timestamp with time zone,
  "executed_by_id" text,
  "executed_by_name" text,
  "execution_notes" text,

  "cancelled_at" timestamp with time zone,
  "cancelled_by_id" text,
  "cancelled_by_name" text,
  "cancellation_reason" text,

  -- ── CAR (SOP §10.6) ────────────────────────────────────────────────────
  "requires_car" boolean NOT NULL DEFAULT false,
  "car_raised_at" timestamp with time zone,
  "car_notes" text,

  -- The write-off or supplier debit-note posting. The hole this migration's
  -- header describes: in Mongo there is no such entry and no column to put it
  -- in, so scrapped stock leaves the shelf and stays on the balance sheet.
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "nonconformances_company_number_uq" UNIQUE ("company_id", "ncr_number"),
  CONSTRAINT "nonconformances_id_company_uq" UNIQUE ("id", "company_id"),

  CONSTRAINT "nonconformances_grn_fk"
    FOREIGN KEY ("goods_receipt_id", "company_id")
    REFERENCES "goods_receipts"("id", "company_id"),
  CONSTRAINT "nonconformances_supplier_fk"
    FOREIGN KEY ("supplier_id", "company_id")
    REFERENCES "parties"("id", "company_id"),

  CONSTRAINT "nonconformances_category_valid" CHECK ("category" IN (
    'received_qty_variance', 'received_damaged', 'stock_deterioration',
    'tool_damage', 'stock_count_variance', 'other'
  )),
  CONSTRAINT "nonconformances_status_valid" CHECK ("status" IN (
    'open', 'disposition_proposed', 'authorized', 'closed', 'cancelled'
  )),
  CONSTRAINT "nonconformances_source_type_valid" CHECK ("source_type" IN (
    'goods_receipt', 'stock_count', 'tool_return', 'stock_deterioration', 'manual'
  )),
  CONSTRAINT "nonconformances_disposition_valid" CHECK ("disposition_type" IN (
    'pending', 'return_to_supplier', 'repair', 'downgrade', 'scrap', 'accept_as_is'
  )),

  -- A goods-receipt NCR names its receipt; the others do not pretend to.
  CONSTRAINT "nonconformances_source_matches_reference" CHECK (
    ("source_type" = 'goods_receipt' AND "goods_receipt_id" IS NOT NULL)
    OR ("source_type" <> 'goods_receipt' AND "goods_receipt_id" IS NULL)
  ),

  -- ── Separation of duties, again in the schema ──────────────────────────
  -- proposeDisposition refuses a proposal from the person who raised the NCR;
  -- authorizeDisposition refuses an authorisation from the person who
  -- proposed it. Both are the SOP's rule and both are guards in an action.
  CONSTRAINT "nonconformances_raiser_does_not_propose" CHECK (
    "created_by_id" IS NULL OR "proposed_by_id" IS NULL
    OR "created_by_id" <> "proposed_by_id"
  ),
  CONSTRAINT "nonconformances_proposer_does_not_authorize" CHECK (
    "proposed_by_id" IS NULL OR "authorized_by_id" IS NULL
    OR "proposed_by_id" <> "authorized_by_id"
  ),

  -- Each decision is a person and a time together, or neither.
  CONSTRAINT "nonconformances_proposal_complete" CHECK (
    ("proposed_by_id" IS NULL) = ("proposed_at" IS NULL)
  ),
  CONSTRAINT "nonconformances_authorization_complete" CHECK (
    ("authorized_by_id" IS NULL) = ("authorized_at" IS NULL)
  ),

  -- A proposal is a real disposition with a reason; 'pending' is the absence
  -- of one, so proposing it says nothing.
  CONSTRAINT "nonconformances_proposed_has_disposition" CHECK (
    "status" <> 'disposition_proposed'
    OR ("disposition_type" <> 'pending' AND "proposed_at" IS NOT NULL
        AND "disposition_reason" IS NOT NULL)
  ),
  CONSTRAINT "nonconformances_authorized_is_authorized" CHECK (
    "status" <> 'authorized'
    OR ("authorized_at" IS NOT NULL AND "disposition_type" <> 'pending')
  ),
  -- Closing is the execution. SOP §10.6: nothing is released for use until
  -- its disposition has been determined AND authorised — so a closed NCR
  -- carries both signatures and the moment it was carried out.
  CONSTRAINT "nonconformances_closed_is_executed" CHECK (
    "status" <> 'closed'
    OR ("executed_at" IS NOT NULL AND "authorized_at" IS NOT NULL
        AND "disposition_type" <> 'pending')
  ),
  CONSTRAINT "nonconformances_cancelled_has_reason" CHECK (
    "status" <> 'cancelled'
    OR ("cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)
  ),
  CONSTRAINT "nonconformances_car_has_time" CHECK (
    NOT "requires_car" OR "car_raised_at" IS NOT NULL
  ),
  CONSTRAINT "nonconformances_impact_not_negative" CHECK (
    "estimated_impact" IS NULL OR "estimated_impact" >= 0
  )
);--> statement-breakpoint

CREATE INDEX "nonconformances_company_status_idx"
  ON "nonconformances" ("company_id", "status", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "nonconformances_company_category_idx"
  ON "nonconformances" ("company_id", "category");--> statement-breakpoint
CREATE INDEX "nonconformances_grn_idx"
  ON "nonconformances" ("company_id", "goods_receipt_id")
  WHERE "goods_receipt_id" IS NOT NULL;--> statement-breakpoint
-- Supplier quality: which suppliers keep generating nonconformances. Partial,
-- because an NCR raised on a count variance has no supplier to blame.
CREATE INDEX "nonconformances_supplier_idx"
  ON "nonconformances" ("company_id", "supplier_id", "created_at" DESC)
  WHERE "supplier_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Lines.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "nonconformance_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "nonconformance_id" uuid NOT NULL REFERENCES "nonconformances"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,

  -- Decision 1: the receipt line this is about, named rather than matched.
  "goods_receipt_line_id" uuid,

  "product_id" uuid,
  "product_name" text,
  "product_sku" text,
  "description" text,
  "unit" text,

  "expected_quantity" numeric(19,4) NOT NULL DEFAULT 0,
  "actual_quantity" numeric(19,4) NOT NULL DEFAULT 0,

  "severity" text NOT NULL DEFAULT 'minor',
  "notes" text,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "nonconformance_lines_ncr_fk"
    FOREIGN KEY ("nonconformance_id", "company_id")
    REFERENCES "nonconformances"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "nonconformance_lines_grn_line_fk"
    FOREIGN KEY ("goods_receipt_line_id", "company_id")
    REFERENCES "goods_receipt_lines"("id", "company_id"),
  CONSTRAINT "nonconformance_lines_product_fk"
    FOREIGN KEY ("product_id", "company_id")
    REFERENCES "products"("id", "company_id"),

  CONSTRAINT "nonconformance_lines_number_uq"
    UNIQUE ("nonconformance_id", "line_number"),
  CONSTRAINT "nonconformance_lines_severity_valid"
    CHECK ("severity" IN ('minor', 'major', 'critical')),
  CONSTRAINT "nonconformance_lines_quantities_not_negative"
    CHECK ("expected_quantity" >= 0 AND "actual_quantity" >= 0)
);--> statement-breakpoint

-- The variance is the difference. Mongo stores it as a third number beside the
-- two that define it, which is §9.3 in miniature.
ALTER TABLE "nonconformance_lines"
  ADD COLUMN "variance" numeric(19,4)
  GENERATED ALWAYS AS ("actual_quantity" - "expected_quantity") STORED;--> statement-breakpoint

CREATE INDEX "nonconformance_lines_ncr_idx"
  ON "nonconformance_lines" ("nonconformance_id");--> statement-breakpoint
CREATE INDEX "nonconformance_lines_grn_line_idx"
  ON "nonconformance_lines" ("goods_receipt_line_id")
  WHERE "goods_receipt_line_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- An NCR line belongs to the receipt the NCR was raised on.
--
-- The composite key stops it crossing tenants; this stops it crossing
-- documents, the same way 0050 does for receipt lines against orders.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION nonconformance_line_matches_receipt() RETURNS trigger AS $$
DECLARE
  v_ncr_grn  uuid;
  v_line_grn uuid;
BEGIN
  IF NEW.goods_receipt_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT goods_receipt_id INTO v_ncr_grn
    FROM nonconformances WHERE id = NEW.nonconformance_id;
  SELECT goods_receipt_id INTO v_line_grn
    FROM goods_receipt_lines WHERE id = NEW.goods_receipt_line_id;

  IF v_ncr_grn IS DISTINCT FROM v_line_grn THEN
    RAISE EXCEPTION
      'Nonconformance line references a line of a different goods receipt than the NCR itself'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "nonconformance_line_receipt_matches"
BEFORE INSERT OR UPDATE ON "nonconformance_lines"
FOR EACH ROW EXECUTE FUNCTION nonconformance_line_matches_receipt();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- An NCR moves forward too.
--
--     open ──► disposition_proposed ──► authorized ──► closed
--       │              │                    │
--       └──────────────┴────────────────────┴──────► cancelled
--
-- A proposal may be revised while it is still only a proposal, so
-- disposition_proposed may return to itself. Nothing comes back from closed:
-- the disposition has been executed and the goods have moved.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION nonconformance_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION
      'Nonconformance % is already %, and cannot be reopened. Raise a new one.',
      OLD.ncr_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'cancelled'
     OR (OLD.status = 'open' AND NEW.status = 'disposition_proposed')
     OR (OLD.status = 'disposition_proposed' AND NEW.status IN ('open', 'authorized'))
     OR (OLD.status = 'authorized' AND NEW.status = 'closed')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A nonconformance cannot move from % to %.', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "nonconformance_status_moves_forward"
BEFORE UPDATE OF status ON "nonconformances"
FOR EACH ROW EXECUTE FUNCTION nonconformance_status_transition();--> statement-breakpoint

-- ============================================================================
-- What an NCR is actually worth, and what it is waiting on.
--
-- Decision 3. For a goods-receipt NCR the affected value is not an estimate:
-- the receipt line carries the unit cost that was frozen when the goods
-- arrived, and the NCR line carries the quantity in question. `estimated_impact`
-- is what a person typed, and is the only figure available when the source is
-- a count variance or a damaged tool — so both are here, and a reader can see
-- which one they are looking at.
-- ============================================================================
CREATE VIEW "nonconformance_state" AS
SELECT ncr.id          AS nonconformance_id,
       ncr.company_id,
       ncr.status,
       ncr.disposition_type,
       ncr.estimated_impact,
       COUNT(ncl.id)::integer                                  AS line_count,
       COALESCE(SUM(ABS(ncl.variance)), 0)::numeric(19,4)      AS total_variance,
       -- How much this NCR is ABOUT, valued at what the goods cost.
       --
       -- Where there is a quantity variance, the variance is the affected
       -- quantity. Where there is not — twenty units arrived, twenty were
       -- expected, and all twenty are rusted — the whole line is in question,
       -- and a variance of zero would value a damage report at nothing.
       --
       -- Null rather than zero when nothing links to a receipt line: no
       -- computable value is a different answer from a value of zero.
       CASE WHEN COUNT(grl.id) = 0 THEN NULL
            ELSE COALESCE(SUM(
              COALESCE(NULLIF(ABS(ncl.variance), 0), ncl.actual_quantity)
              * grl.unit_cost
            ), 0)::numeric(19,4)
       END                                                     AS affected_value,
       MAX(CASE ncl.severity WHEN 'critical' THEN 3 WHEN 'major' THEN 2 ELSE 1 END)
                                                               AS max_severity_rank,
       CASE MAX(CASE ncl.severity WHEN 'critical' THEN 3 WHEN 'major' THEN 2 ELSE 1 END)
         WHEN 3 THEN 'critical' WHEN 2 THEN 'major' ELSE 'minor'
       END                                                     AS max_severity,
       -- What the SOP is waiting for, rather than what happened last.
       CASE ncr.status
         WHEN 'open'                 THEN 'awaiting disposition'
         WHEN 'disposition_proposed' THEN 'awaiting authorisation'
         WHEN 'authorized'           THEN 'awaiting execution'
         ELSE NULL
       END                                                     AS awaiting
  FROM nonconformances ncr
  LEFT JOIN nonconformance_lines ncl ON ncl.nonconformance_id = ncr.id
  LEFT JOIN goods_receipt_lines grl ON grl.id = ncl.goods_receipt_line_id
 GROUP BY ncr.id, ncr.company_id, ncr.status, ncr.disposition_type, ncr.estimated_impact;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nonconformances', 'nonconformance_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "nonconformances" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "nonconformance_lines" TO app_user;--> statement-breakpoint
GRANT SELECT ON "nonconformance_state" TO app_user;
