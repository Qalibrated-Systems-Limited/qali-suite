-- ============================================================================
-- 0050 — Procurement: the receipt, and the end of the suspense account.
--
-- This is the migration §9G was written for.
--
-- Bills went to Postgres in 0015 with three-way match attached: approveBill
-- posts a stocked line to GR/IR clearing when `company_settings.require_grn`
-- is on, records `used_grni = true, inventory_moved = false`, and defers the
-- goods. `listBillsAwaitingGRN()` (bills.ts) already lists what is waiting.
-- What was never ported is the document that ARRIVES — so the clearing entry
-- was raised by grn-actions.js into MongoDB, against a ledger no screen reads,
-- and GR/IR could only grow. A suspense account with no possible counterparty,
-- on the balance sheet of every tenant who switched on a control this port
-- itself shipped.
--
-- The two halves, once this lands:
--
--   goods first (PO-sourced)     receipt:  DR Inventory   CR GR/IR
--                                bill:     DR GR/IR       CR Accounts Payable
--
--   bill first (require_grn)     bill:     DR GR/IR       CR Accounts Payable
--                                receipt:  DR Inventory   CR GR/IR
--
-- Either order nets GR/IR to zero once both documents exist. `gr_ir_open_items`
-- at the foot of this file is what shows the ones that have not.
--
-- ── Four decisions ──────────────────────────────────────────────────────────
--
-- 1. THE PO LINE LINK IS A FOREIGN KEY, NOT A document_flow ROW.
--    §9G planned to use `document_flow` for this, on the quote_line_invoiced
--    precedent. Building it showed why that is wrong HERE, and the reason is
--    specific rather than a matter of taste.
--
--    A document_flow line row must carry a quantity, and that quantity is
--    meant to be immutable — `quote_line_invoiced` is correct precisely
--    because an invoice line's quantity never moves once written. A goods
--    receipt line's does: it is received first and accepted (or rejected, or
--    part-accepted) later, by different people, as a separate decision. Put
--    that number in document_flow and it becomes a second, drifting copy of a
--    value that lives on the receipt line — which is the exact fault §9.3 and
--    decision 1 of 0049 exist to remove.
--
--    So a receipt line references its order line directly, the way SAP's
--    material document references the PO item (MSEG.EBELN/EBELP). It is
--    many-receipts-to-one-order-line, which a foreign key models exactly.
--
--    `document_flow` still earns its place — for the receipt-to-bill pairing
--    below, which is genuinely many-to-many and where the quantity IS frozen.
--
-- 2. THE OUTCOME OF A RECEIPT IS DERIVED FROM ITS LINES.
--    Mongo carries 'accepted', 'partially_accepted' and 'rejected' as header
--    statuses beside per-line decisions that say the same thing, so the header
--    and the lines can disagree and nothing notices. `has_discrepancy` is a
--    third stored value that is a pure function of the lines.
--
--    `status` here holds only what a person did — draft, submitted for
--    acceptance, finalised, voided. What the decision WAS is derived in
--    `goods_receipt_state`, along with the discrepancy flag.
--
-- 3. THE UNIT COST IS ON THE RECEIPT LINE, NOT LOOKED UP AT ACCEPTANCE.
--    postGRNAcceptanceJournal (grn-actions.js:167) finds the matching bill
--    line by product id — `bl.product?.id === grnLine.productId` — throws if
--    there is no match, and silently takes the FIRST if a bill has two lines
--    for the same product, which is ordinary (two deliveries, two prices).
--    The cost that will be posted is decided when the receipt is written and
--    frozen on the line, so acceptance has nothing to guess.
--
-- 4. `inventoryApplied` GOES.
--    It is a per-line boolean guarding against double-application "on retry /
--    replay" — a claim flag standing in for a transaction. Acceptance here is
--    one statement sequence in one transaction, and the receipt's own status
--    is what stops it happening twice.
-- ============================================================================

-- A goods receipt posts to the ledger, so it can be a journal entry's source.
-- ADD VALUE only — nothing in this migration writes it, which is what keeps it
-- legal inside the migrator's transaction.
ALTER TYPE "public"."source_document_type"
  ADD VALUE IF NOT EXISTS 'goods_receipt';--> statement-breakpoint

-- Receipts are numbered like every other document (0035): the tenant's prefix,
-- through the race-free counter, never a literal in application code.
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "grn_prefix" text NOT NULL DEFAULT 'GRN';--> statement-breakpoint

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
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The receipt.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "goods_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "grn_number" text NOT NULL,

  -- What this receives against. An unscheduled receipt has neither reference —
  -- goods turned up — and the CHECK below keeps the trio honest rather than
  -- leaving `source.type` as a label that may or may not match the ids.
  "source_type" text NOT NULL,
  "purchase_order_id" uuid,
  "bill_id" uuid,
  "proforma_invoice_number" text,
  "packing_list_number" text,

  "supplier_id" uuid,
  "supplier_name" text,

  -- Only what somebody did. The outcome is derived — decision 2.
  "status" text NOT NULL DEFAULT 'draft',

  "received_date" date NOT NULL DEFAULT CURRENT_DATE,
  "received_by_id" text,
  "received_by_name" text,

  "discrepancy_notes" text,
  "notes" text,

  -- ── Acceptance (SOP §10.1.2 step 5) ────────────────────────────────────
  -- The SOP requires written confirmation from BOTH Sales and Finance, so each
  -- is its own sign-off and each is auditable on its own.
  "sales_accepted_by_id" text,
  "sales_accepted_by_name" text,
  "sales_accepted_at" timestamp with time zone,
  "sales_acceptance_notes" text,
  "finance_accepted_by_id" text,
  "finance_accepted_by_name" text,
  "finance_accepted_at" timestamp with time zone,
  "finance_acceptance_notes" text,
  "accepted_at" timestamp with time zone,

  "rejected_at" timestamp with time zone,
  "rejected_by_id" text,
  "rejected_by_name" text,
  "rejection_reason" text,

  "voided_at" timestamp with time zone,
  "voided_by_id" text,
  "voided_by_name" text,
  "void_reason" text,

  -- The acceptance posting. Mongo creates this entry and never records its id
  -- anywhere, so a GRN cannot show what it posted and the ledger cannot be
  -- walked back to the receipt. Every other posting document in this schema
  -- carries its entry; so does this one.
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "goods_receipts_company_number_uq" UNIQUE ("company_id", "grn_number"),
  CONSTRAINT "goods_receipts_id_company_uq" UNIQUE ("id", "company_id"),

  CONSTRAINT "goods_receipts_po_fk"
    FOREIGN KEY ("purchase_order_id", "company_id")
    REFERENCES "purchase_orders"("id", "company_id"),
  CONSTRAINT "goods_receipts_bill_fk"
    FOREIGN KEY ("bill_id", "company_id")
    REFERENCES "bills"("id", "company_id"),
  CONSTRAINT "goods_receipts_supplier_fk"
    FOREIGN KEY ("supplier_id", "company_id")
    REFERENCES "parties"("id", "company_id"),

  CONSTRAINT "goods_receipts_source_type_valid"
    CHECK ("source_type" IN ('purchase_order', 'bill', 'unscheduled')),

  CONSTRAINT "goods_receipts_status_valid"
    CHECK ("status" IN ('draft', 'pending_acceptance', 'finalised', 'voided')),

  -- The source type and the references it implies cannot disagree.
  CONSTRAINT "goods_receipts_source_matches_reference" CHECK (
    ("source_type" = 'purchase_order' AND "purchase_order_id" IS NOT NULL AND "bill_id" IS NULL)
    OR ("source_type" = 'bill' AND "bill_id" IS NOT NULL)
    OR ("source_type" = 'unscheduled' AND "purchase_order_id" IS NULL AND "bill_id" IS NULL)
  ),

  -- ── Separation of duties, in the schema rather than in the action ───────
  -- Ordering and receiving being the same person is the classic procurement
  -- fraud, and one person signing both halves of a two-signature control is
  -- the same failure one step later. grn-actions.js guards both at the call
  -- site; a guard the database holds cannot be reached around by a second
  -- caller, a script or an import.
  CONSTRAINT "goods_receipts_two_distinct_signatures" CHECK (
    "sales_accepted_by_id" IS NULL
    OR "finance_accepted_by_id" IS NULL
    OR "sales_accepted_by_id" <> "finance_accepted_by_id"
  ),
  CONSTRAINT "goods_receipts_receiver_does_not_sign" CHECK (
    ("created_by_id" IS NULL OR "sales_accepted_by_id" IS NULL
      OR "created_by_id" <> "sales_accepted_by_id")
    AND ("created_by_id" IS NULL OR "finance_accepted_by_id" IS NULL
      OR "created_by_id" <> "finance_accepted_by_id")
  ),

  -- A sign-off is a person and a time together, or neither.
  CONSTRAINT "goods_receipts_sales_signature_complete" CHECK (
    ("sales_accepted_by_id" IS NULL) = ("sales_accepted_at" IS NULL)
  ),
  CONSTRAINT "goods_receipts_finance_signature_complete" CHECK (
    ("finance_accepted_by_id" IS NULL) = ("finance_accepted_at" IS NULL)
  ),

  -- Finalising is what admits stock and posts the entry, and it needs both
  -- signatures to have happened — unless the whole receipt was rejected, which
  -- is its own decision with its own reason.
  CONSTRAINT "goods_receipts_finalised_is_signed_or_rejected" CHECK (
    "status" <> 'finalised'
    OR ("accepted_at" IS NOT NULL AND "sales_accepted_at" IS NOT NULL
        AND "finance_accepted_at" IS NOT NULL)
    OR ("rejected_at" IS NOT NULL AND "rejection_reason" IS NOT NULL)
  ),

  CONSTRAINT "goods_receipts_voided_has_reason" CHECK (
    "status" <> 'voided' OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE INDEX "goods_receipts_company_status_idx"
  ON "goods_receipts" ("company_id", "status", "received_date" DESC);--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx"
  ON "goods_receipts" ("company_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "goods_receipts_bill_idx"
  ON "goods_receipts" ("company_id", "bill_id")
  WHERE "bill_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "goods_receipts_supplier_idx"
  ON "goods_receipts" ("company_id", "supplier_id")
  WHERE "supplier_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Receipt lines.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "goods_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "goods_receipt_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,

  -- Decision 1: the order line this receives against, directly. Null for an
  -- unscheduled receipt, and for a bill-sourced receipt whose bill carried no
  -- purchase order.
  "purchase_order_line_id" uuid,

  -- A receipt receives goods, so the product is not optional the way it is on
  -- an order line (which may buy a service). The snapshot is what the
  -- storekeeper was looking at.
  "product_id" uuid NOT NULL,
  "product_name" text NOT NULL,
  "product_sku" text,
  "description" text NOT NULL,
  "unit" text NOT NULL DEFAULT 'pcs',

  "expected_quantity" numeric(19,4) NOT NULL DEFAULT 0,
  "received_quantity" numeric(19,4) NOT NULL,
  "accepted_quantity" numeric(19,4) NOT NULL DEFAULT 0,

  -- Decision 3: what these goods cost, frozen when the receipt is written.
  -- This is what the acceptance entry debits Inventory for and what re-costs
  -- the product — never a lookup-by-product at acceptance time.
  "unit_cost" numeric(19,4) NOT NULL DEFAULT 0,

  -- Inspection (SOP §10.1.2 step 3).
  "packaging_condition" text NOT NULL DEFAULT 'good',
  "physical_condition" text NOT NULL DEFAULT 'good',
  "inspection_notes" text,
  "photo_urls" text[] NOT NULL DEFAULT '{}',
  "storage_location" text,

  "line_status" text NOT NULL DEFAULT 'pending',
  "reject_reason" text,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "goods_receipt_lines_grn_fk"
    FOREIGN KEY ("goods_receipt_id", "company_id")
    REFERENCES "goods_receipts"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "goods_receipt_lines_po_line_fk"
    FOREIGN KEY ("purchase_order_line_id", "company_id")
    REFERENCES "purchase_order_lines"("id", "company_id"),
  CONSTRAINT "goods_receipt_lines_product_fk"
    FOREIGN KEY ("product_id", "company_id")
    REFERENCES "products"("id", "company_id"),

  CONSTRAINT "goods_receipt_lines_number_uq"
    UNIQUE ("goods_receipt_id", "line_number"),
  CONSTRAINT "goods_receipt_lines_id_company_uq" UNIQUE ("id", "company_id"),

  CONSTRAINT "goods_receipt_lines_quantities_not_negative" CHECK (
    "expected_quantity" >= 0 AND "received_quantity" >= 0 AND "accepted_quantity" >= 0
  ),
  -- You cannot accept more than turned up. The rejected quantity is the
  -- remainder, which is why it is generated rather than typed.
  CONSTRAINT "goods_receipt_lines_accepted_within_received"
    CHECK ("accepted_quantity" <= "received_quantity"),
  CONSTRAINT "goods_receipt_lines_unit_cost_not_negative" CHECK ("unit_cost" >= 0),

  CONSTRAINT "goods_receipt_lines_packaging_condition_valid"
    CHECK ("packaging_condition" IN ('good', 'damaged', 'moisture', 'tampered')),
  CONSTRAINT "goods_receipt_lines_physical_condition_valid"
    CHECK ("physical_condition" IN ('good', 'broken', 'deformed', 'defective')),
  CONSTRAINT "goods_receipt_lines_status_valid"
    CHECK ("line_status" IN ('pending', 'accepted', 'rejected', 'hold')),

  -- Rejecting goods says why. The SOP's §10.6 nonconformance flow starts from
  -- this text, so an empty one is a dead end for whoever has to act on it.
  CONSTRAINT "goods_receipt_lines_rejection_has_reason" CHECK (
    "line_status" <> 'rejected' OR "reject_reason" IS NOT NULL
  )
);--> statement-breakpoint

ALTER TABLE "goods_receipt_lines"
  ADD COLUMN "rejected_quantity" numeric(19,4)
  GENERATED ALWAYS AS ("received_quantity" - "accepted_quantity") STORED;--> statement-breakpoint

ALTER TABLE "goods_receipt_lines"
  ADD COLUMN "accepted_value" numeric(19,4)
  GENERATED ALWAYS AS (ROUND("accepted_quantity" * "unit_cost", 4)) STORED;--> statement-breakpoint

CREATE INDEX "goods_receipt_lines_grn_idx"
  ON "goods_receipt_lines" ("goods_receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_po_line_idx"
  ON "goods_receipt_lines" ("purchase_order_line_id")
  WHERE "purchase_order_line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_product_idx"
  ON "goods_receipt_lines" ("company_id", "product_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A receipt line belongs to its receipt's order.
--
-- The composite foreign keys stop a line pointing at another TENANT's order
-- line. They cannot stop it pointing at a different order of the same tenant,
-- which would put received quantity against something nobody ordered here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION goods_receipt_line_matches_order() RETURNS trigger AS $$
DECLARE
  v_grn_po uuid;
  v_line_po uuid;
BEGIN
  IF NEW.purchase_order_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT purchase_order_id INTO v_grn_po
    FROM goods_receipts WHERE id = NEW.goods_receipt_id;
  SELECT purchase_order_id INTO v_line_po
    FROM purchase_order_lines WHERE id = NEW.purchase_order_line_id;

  IF v_grn_po IS DISTINCT FROM v_line_po THEN
    RAISE EXCEPTION
      'Receipt line references a line of a different purchase order than the receipt itself'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Postgres fires BEFORE row triggers in NAME order, and here the order is
-- part of the design rather than an accident: the immutability rule must
-- speak first, or somebody editing a submitted receipt is told about the
-- order tolerance instead of being told the line is frozen. The numeric
-- prefixes make that ordering explicit rather than a property of the words.
CREATE TRIGGER "goods_receipt_line_20_order_matches"
BEFORE INSERT OR UPDATE ON "goods_receipt_lines"
FOR EACH ROW EXECUTE FUNCTION goods_receipt_line_matches_order();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Over-receipt is refused unless the order allowed for it (0049, decision 3).
--
-- Mongo accepts any quantity and sets `hasDiscrepancy`, so an over-receipt is
-- recorded and never approved by anybody — the PO's outstanding quantity just
-- goes negative and the buyer finds out from the ledger. SAP's over-delivery
-- tolerance and Odoo's qty tolerance both put the allowance on the ORDER, in
-- advance, which makes accepting more than you ordered a decision somebody
-- made rather than an arithmetic accident.
--
-- The check is across ALL live receipts against the line, not just this one:
-- three deliveries of 40 against an order for 100 is an over-receipt on the
-- third, and only a cumulative test sees it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION goods_receipt_respects_order_tolerance() RETURNS trigger AS $$
DECLARE
  v_ordered   numeric(19,4);
  v_tolerance numeric(9,4);
  v_received  numeric(19,4);
  v_limit     numeric(19,4);
  v_po_number text;
BEGIN
  IF NEW.purchase_order_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pol.quantity, po.receipt_tolerance_percentage, po.po_number
    INTO v_ordered, v_tolerance, v_po_number
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.purchase_order_id
   WHERE pol.id = NEW.purchase_order_line_id;

  -- Everything already booked against this order line, plus this row. A voided
  -- receipt never happened; a draft has not been submitted, but the goods are
  -- on the floor, so it counts.
  SELECT COALESCE(SUM(grl.received_quantity), 0)
    INTO v_received
    FROM goods_receipt_lines grl
    JOIN goods_receipts grn ON grn.id = grl.goods_receipt_id
   WHERE grl.purchase_order_line_id = NEW.purchase_order_line_id
     AND grl.id <> NEW.id
     AND grn.status <> 'voided';

  v_limit := ROUND(v_ordered * (1 + v_tolerance / 100), 4);

  IF v_received + NEW.received_quantity > v_limit THEN
    RAISE EXCEPTION
      'Receiving % against % would bring the total to % on an order for % (tolerance %%%). Raise the ordered quantity or the receipt tolerance on the order first.',
      NEW.received_quantity, v_po_number, v_received + NEW.received_quantity, v_ordered, v_tolerance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "goods_receipt_line_30_tolerance"
BEFORE INSERT OR UPDATE OF received_quantity, purchase_order_line_id
ON "goods_receipt_lines"
FOR EACH ROW EXECUTE FUNCTION goods_receipt_respects_order_tolerance();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Receipt lines are editable until the receipt is submitted.
--
-- Same rule and same reasoning as purchase_order_lines (0049): once the
-- storekeeper has signed and the goods are in HOLD, the line is evidence of
-- what arrived. Acceptance still writes to it — that is a decision ABOUT the
-- line, made through `accepted_quantity` and `line_status` — so those columns
-- are exempt while the receipt is awaiting acceptance.
--
-- ONE EXCEPTION SURVIVES FINALISATION, and only one: a line finalised as
-- 'hold' is a line whose decision was explicitly DEFERRED to a nonconformance
-- (0051). The goods are on hand, on hold, unissuable and unbought, and they
-- stay that way until the NCR's disposition is authorised and carried out.
-- Resolving that line is what closing the NCR means, so the trigger permits a
-- move OUT of 'hold' and nothing else — a decided line is still final, and a
-- line cannot be pushed back INTO 'hold' to reopen a closed question.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION goods_receipt_lines_are_editable() RETURNS trigger AS $$
DECLARE
  v_status text;
  target uuid := COALESCE(NEW.goods_receipt_id, OLD.goods_receipt_id);
BEGIN
  SELECT status INTO v_status FROM goods_receipts WHERE id = target;

  -- The receipt is already gone: this is ON DELETE CASCADE, not an edit.
  IF v_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Acceptance: only the decision columns may move, and only while the
  -- receipt is still awaiting one. A line finalised as 'hold' may also be
  -- resolved later, by the nonconformance that took the decision over.
  IF TG_OP = 'UPDATE'
     AND (v_status = 'pending_acceptance'
          OR (v_status = 'finalised' AND OLD.line_status = 'hold'))
  THEN
    IF ROW(NEW.product_id, NEW.received_quantity, NEW.expected_quantity,
           NEW.unit_cost, NEW.purchase_order_line_id, NEW.line_number)
       IS DISTINCT FROM
       ROW(OLD.product_id, OLD.received_quantity, OLD.expected_quantity,
           OLD.unit_cost, OLD.purchase_order_line_id, OLD.line_number)
    THEN
      RAISE EXCEPTION
        'What was received cannot be changed once the receipt is submitted — only the acceptance decision can. Void the receipt and raise a new one.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Out of 'hold', never back into it: the deferral is resolved once.
    IF v_status = 'finalised' AND NEW.line_status = 'hold' THEN
      RAISE EXCEPTION
        'A held line on a finalised receipt is resolved by its nonconformance disposition, not left held again.'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Goods receipt lines cannot be changed once the receipt leaves draft (status: %).',
    v_status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "goods_receipt_line_10_editable"
BEFORE INSERT OR UPDATE OR DELETE ON "goods_receipt_lines"
FOR EACH ROW EXECUTE FUNCTION goods_receipt_lines_are_editable();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A receipt moves forward, and voiding is for drafts only.
--
-- voidGRN (grn-actions.js:1243) already refuses anything past draft — "only
-- draft GRNs can be voided, use reject for submitted GRNs" — because once the
-- goods are in HOLD every transition has to be auditable. That rule matters
-- more here than it did there: `purchase_order_line_received` and
-- `goods_receipt_state` both treat a voided receipt as never having happened,
-- so voiding a FINALISED receipt would silently withdraw accepted quantity
-- from the order while the stock it admitted stayed on the shelf, and the
-- Inventory debit stayed in the ledger.
--
-- The legal moves, and nothing else:
--
--     draft ──────────► pending_acceptance ──────────► finalised
--       │
--       └──────────► voided
--
-- A finalised receipt is undone by a reversing document, not by editing the
-- one that recorded what arrived.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION goods_receipt_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'draft' AND NEW.status IN ('pending_acceptance', 'voided'))
     OR (OLD.status = 'pending_acceptance' AND NEW.status = 'finalised')
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'finalised' THEN
    RAISE EXCEPTION
      'A goods receipt must be submitted for acceptance before it can be finalised.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'voided' THEN
    RAISE EXCEPTION
      'Only a draft goods receipt can be voided (this one is %). A submitted receipt is rejected; a finalised one is reversed.',
      OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE EXCEPTION 'A goods receipt cannot move from % to %.', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "goods_receipt_status_moves_forward"
BEFORE UPDATE OF status ON "goods_receipts"
FOR EACH ROW EXECUTE FUNCTION goods_receipt_status_transition();--> statement-breakpoint

-- ============================================================================
-- document_flow learns about receipts.
--
-- Decision 1 keeps the ORDER link out of here. What belongs here is the
-- receipt-to-bill pairing that GR/IR clearing rests on: a bill may settle
-- several receipts and a receipt may be billed across several bills, the
-- quantity that flowed is fixed at the moment the bill is written, and nothing
-- later moves it. That is exactly the shape document_flow was built for.
-- ============================================================================
ALTER TABLE "document_flow"
  DROP CONSTRAINT "document_flow_predecessor_type_valid";--> statement-breakpoint
ALTER TABLE "document_flow"
  ADD CONSTRAINT "document_flow_predecessor_type_valid" CHECK ("predecessor_type" IN (
    'quote', 'quote_line', 'sales_order', 'sales_order_line',
    'invoice', 'invoice_line', 'purchase_order', 'purchase_order_line',
    'goods_receipt', 'goods_receipt_line', 'bill', 'bill_line'
  ));--> statement-breakpoint

ALTER TABLE "document_flow"
  DROP CONSTRAINT "document_flow_successor_type_valid";--> statement-breakpoint
ALTER TABLE "document_flow"
  ADD CONSTRAINT "document_flow_successor_type_valid" CHECK ("successor_type" IN (
    'quote', 'quote_line', 'sales_order', 'sales_order_line',
    'invoice', 'invoice_line', 'purchase_order', 'purchase_order_line',
    'goods_receipt', 'goods_receipt_line', 'bill', 'bill_line'
  ));--> statement-breakpoint

-- ============================================================================
-- How much of each order line has ARRIVED, and how much was ADMITTED.
--
-- The half of decision 1 in 0049 that 0049 could not write. Two numbers,
-- because they answer two questions and the source collapsed them into one:
--
--   received_quantity  what physically turned up, whatever was later decided
--                      about it — this is what the tolerance check measures
--   accepted_quantity  what was admitted to stock and debited to Inventory
--
-- Neither is stored, and a voided receipt contributes to neither.
-- ============================================================================
CREATE VIEW "purchase_order_line_received" AS
SELECT pol.id                AS purchase_order_line_id,
       pol.purchase_order_id,
       pol.company_id,
       pol.quantity          AS ordered_quantity,
       COALESCE(SUM(grl.received_quantity) FILTER (
         WHERE grn.status IN ('draft', 'pending_acceptance', 'finalised')
       ), 0)::numeric(19,4)  AS received_quantity,
       COALESCE(SUM(grl.accepted_quantity) FILTER (
         WHERE grn.status = 'finalised'
       ), 0)::numeric(19,4)  AS accepted_quantity
  FROM purchase_order_lines pol
  LEFT JOIN goods_receipt_lines grl ON grl.purchase_order_line_id = pol.id
  LEFT JOIN goods_receipts grn ON grn.id = grl.goods_receipt_id
 GROUP BY pol.id, pol.purchase_order_id, pol.company_id, pol.quantity;--> statement-breakpoint

-- ============================================================================
-- The state of an order — expiry and progress, both derived (0049, decision 2).
--
-- `is_expired` replaces the pre-save hook that flipped status to 'expired' on
-- any save; `receipt_state` and `bill_state` replace the 'partial' and
-- 'received' statuses that were computed from the counter decision 1 removed.
-- ============================================================================
CREATE VIEW "purchase_order_state" AS
SELECT po.id                                 AS purchase_order_id,
       po.company_id,
       po.status,
       (po.valid_until IS NOT NULL
         AND po.valid_until < CURRENT_DATE
         AND po.status IN ('draft', 'sent', 'confirmed')) AS is_expired,
       COALESCE(agg.ordered, 0)::numeric(19,4)  AS ordered_quantity,
       COALESCE(agg.received, 0)::numeric(19,4) AS received_quantity,
       COALESCE(agg.accepted, 0)::numeric(19,4) AS accepted_quantity,
       COALESCE(agg.billed, 0)::numeric(19,4)   AS billed_quantity,
       CASE
         WHEN COALESCE(agg.ordered, 0) = 0 THEN 'none'
         WHEN COALESCE(agg.accepted, 0) = 0 THEN 'none'
         WHEN COALESCE(agg.accepted, 0) >= COALESCE(agg.ordered, 0) THEN 'complete'
         ELSE 'partial'
       END AS receipt_state,
       CASE
         WHEN COALESCE(agg.ordered, 0) = 0 THEN 'none'
         WHEN COALESCE(agg.billed, 0) = 0 THEN 'none'
         WHEN COALESCE(agg.billed, 0) >= COALESCE(agg.ordered, 0) THEN 'complete'
         ELSE 'partial'
       END AS bill_state
  FROM purchase_orders po
  LEFT JOIN (
    SELECT r.purchase_order_id,
           SUM(r.ordered_quantity)  AS ordered,
           SUM(r.received_quantity) AS received,
           SUM(r.accepted_quantity) AS accepted,
           SUM(b.billed_quantity)   AS billed
      FROM purchase_order_line_received r
      JOIN purchase_order_line_billed b
        ON b.purchase_order_line_id = r.purchase_order_line_id
     GROUP BY r.purchase_order_id
  ) agg ON agg.purchase_order_id = po.id;--> statement-breakpoint

-- ============================================================================
-- The state of a receipt — the outcome its lines record (decision 2).
--
-- 'accepted', 'partially_accepted', 'rejected' and `has_discrepancy` were four
-- stored values that the lines already determined. Here they are read from the
-- lines, so the header cannot say one thing while the lines say another.
-- ============================================================================
CREATE VIEW "goods_receipt_state" AS
SELECT grn.id            AS goods_receipt_id,
       grn.company_id,
       grn.status,
       COALESCE(SUM(grl.received_quantity), 0)::numeric(19,4) AS received_quantity,
       COALESCE(SUM(grl.accepted_quantity), 0)::numeric(19,4) AS accepted_quantity,
       COALESCE(SUM(grl.rejected_quantity), 0)::numeric(19,4) AS rejected_quantity,
       COALESCE(SUM(grl.accepted_value), 0)::numeric(19,4)    AS accepted_value,
       CASE
         WHEN grn.status = 'voided' THEN 'voided'
         WHEN grn.status <> 'finalised' THEN 'pending'
         WHEN COALESCE(SUM(grl.accepted_quantity), 0) = 0 THEN 'rejected'
         WHEN COALESCE(SUM(grl.rejected_quantity), 0) = 0 THEN 'accepted'
         ELSE 'partially_accepted'
       END AS outcome,
       -- Anything the storekeeper should be flagging: a short or over
       -- delivery, or goods that arrived in any condition but good.
       COALESCE(BOOL_OR(
         grl.received_quantity <> grl.expected_quantity
         OR grl.packaging_condition <> 'good'
         OR grl.physical_condition <> 'good'
       ), false) AS has_discrepancy,
       COALESCE(BOOL_OR(
         grl.expected_quantity > 0 AND grl.received_quantity > grl.expected_quantity
       ), false) AS has_over_receipt
  FROM goods_receipts grn
  LEFT JOIN goods_receipt_lines grl ON grl.goods_receipt_id = grn.id
 GROUP BY grn.id, grn.company_id, grn.status;--> statement-breakpoint

-- ============================================================================
-- GR/IR, open.
--
-- The report that could not exist before this migration, and the reason §9G
-- put procurement first. Every order line where the value RECEIVED and the
-- value BILLED disagree is an open item in the clearing account: goods in
-- without an invoice, or an invoice without the goods. A zero here is a
-- cleared position; the balance of the GR/IR account should equal the sum of
-- this view, and anything else is a reconciliation somebody needs to see.
-- ============================================================================
CREATE VIEW "gr_ir_open_items" AS
SELECT r.company_id,
       r.purchase_order_id,
       po.po_number,
       po.supplier_id,
       po.supplier_name,
       r.purchase_order_line_id,
       pol.line_number,
       pol.description,
       pol.unit_price,
       r.ordered_quantity,
       r.accepted_quantity,
       b.billed_quantity,
       (r.accepted_quantity - b.billed_quantity)::numeric(19,4) AS uninvoiced_quantity,
       ROUND((r.accepted_quantity - b.billed_quantity) * pol.unit_price, 4) AS uninvoiced_value
  FROM purchase_order_line_received r
  JOIN purchase_order_line_billed b
    ON b.purchase_order_line_id = r.purchase_order_line_id
  JOIN purchase_order_lines pol ON pol.id = r.purchase_order_line_id
  JOIN purchase_orders po ON po.id = r.purchase_order_id
 WHERE r.accepted_quantity <> b.billed_quantity;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['goods_receipts', 'goods_receipt_lines']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipts" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipt_lines" TO app_user;--> statement-breakpoint
GRANT SELECT ON "purchase_order_line_received" TO app_user;--> statement-breakpoint
GRANT SELECT ON "purchase_order_state" TO app_user;--> statement-breakpoint
GRANT SELECT ON "goods_receipt_state" TO app_user;--> statement-breakpoint
GRANT SELECT ON "gr_ir_open_items" TO app_user;
