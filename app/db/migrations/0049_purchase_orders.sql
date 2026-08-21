-- ============================================================================
-- 0049 — Procurement: the order.
--
-- The first of three migrations moving procurement. This one carries purchase
-- orders and their lines; goods receipts and the GR/IR closure follow in 0050,
-- nonconformance in 0051.
--
-- Procurement is ported ahead of larger modules for the reason §9G gives: it
-- is the one the port ALREADY BROKE. Bills went to Postgres in 0015 carrying
-- three-way match with them — `bills.used_grni`, a `grni_account_id` on
-- createBill, `company_settings.require_grn` — while the goods receipt that
-- clears GR/IR stayed in Mongo and cleared against the Mongo ledger. A tenant
-- who switches that control on today gets a suspense account that can only
-- accumulate. 0050 closes it; this migration is the order it receives against.
--
-- Four decisions, made here once so 0050 and 0051 do not re-argue them.
--
-- 1. RECEIVED AND BILLED ARE TWO DIFFERENT QUESTIONS, AND NEITHER IS A COUNTER.
--    `purchaseOrder.lines[].receivedQuantity` is a stored counter, and it is
--    incremented from TWO places that do not know about each other:
--
--      purchaseOrder.js:751   convertToBill() -> recordReceiving()
--      grn-actions.js:1071    acceptGRN(), for a PO-sourced receipt
--
--    Nothing prevents both. A PO billed through convertToBill and also
--    received through a GRN counts the same goods twice, and because
--    getAvailableLines() gates on `quantity - receivedQuantity`, the order
--    then refuses to bill quantity that was never billed. This is the fifth
--    instance of the pattern §9.3 named and 0045-0048 removed five of.
--
--    The deeper fault is that one number was answering two questions. How much
--    has been INVOICED BY THE SUPPLIER and how much has PHYSICALLY ARRIVED are
--    independent facts — that gap is precisely what GR/IR exists to hold. So
--    there is no counter here at all: `purchase_order_line_billed` (below) and
--    `purchase_order_line_received` (0050) derive each from the documents that
--    justify it, the way `quote_line_invoiced` (0041) does.
--
-- 2. EXPIRY IS NOT A STATUS SOMEBODY WROTE.
--    The Mongo pre-save hook flips status to 'expired' whenever validUntil has
--    passed — on ANY save, for any unrelated reason. The model documents its
--    own workaround: reopen() has to push validUntil forward 30 days because
--    "the pre-save hook re-expires any PO whose validUntil is in the past, so
--    without this the PO would snap straight back to expired on save". That is
--    a stored value fighting the function that defines it.
--
--    Expiry is `valid_until < today`. It is derived in `purchase_order_state`
--    (0050, where the receipt side it also reports becomes available), it
--    needs no hook, and reopening an order is then just moving the date.
--
--    Receipt progress goes the same way: 'partial' and 'received' were status
--    values computed from the counter in decision 1. They are derived too, so
--    `status` now holds only what a PERSON chose — draft, sent, confirmed,
--    cancelled, closed.
--
-- 3. OVER-RECEIPT IS A DECISION, NOT AN ARITHMETIC ACCIDENT.
--    Mongo accepts any received quantity and sets a `hasDiscrepancy` flag,
--    which means an over-receipt is recorded but never approved by anyone.
--    `receipt_tolerance_percentage` sits on the order, defaults to 0, and 0050
--    enforces it: receiving beyond ordered x (1 + tolerance) is refused by the
--    database. Slack is something a buyer grants on the order, in advance —
--    SAP's over-delivery tolerance and Odoo's qty tolerance both work this way.
--
-- 4. SNAPSHOTS STAY, REFERENCES DO NOT GET COPIED (§9.4, §8.6).
--    The supplier's name and the agreed unit price are what was ORDERED and
--    what the supplier was sent; they are frozen. The expense/asset account is
--    a live reference on an internal planning document that nobody outside has
--    seen — it is a foreign key, and its code and name are joined, not copied.
--
-- Two things the source carried that are simply gone:
--
--   * `lines` capped at 50 by a validator. That cap is an artifact of storing
--     lines inside a 16MB document. Rows do not have it.
--   * `sentTo`, `deliveredAt`, `deliveryAttempts`, `lastDeliveryError` — four
--     columns describing the EMAIL rather than the order, and unable to answer
--     "what happened on the second attempt" because each send overwrote the
--     last. `document_deliveries` (0041) already models this, one row per
--     attempt, and already accepts 'purchase_order'.
-- ============================================================================

CREATE TABLE "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "po_number" text NOT NULL,

  -- The supplier is a reference. The name beside it is what was printed on
  -- what the supplier received (§9.4) — renaming a party must not rewrite an
  -- order already sent.
  "supplier_id" uuid NOT NULL,
  "supplier_name" text NOT NULL,
  "supplier_tax_pin" text,
  "supplier_email" text,
  "supplier_phone" text,
  "supplier_address" text,

  "po_date" date NOT NULL,
  "expected_delivery_date" date,
  "valid_until" date,

  -- Only what a person chose. 'expired', 'partial' and 'received' were all
  -- computed values wearing a status — see decision 2, and the
  -- `purchase_order_state` view in 0050.
  "status" text NOT NULL DEFAULT 'draft',

  "currency" text NOT NULL DEFAULT 'KES',

  -- Withholding, as agreed with this supplier. The RATE is the term; the
  -- amount is arithmetic and is generated below.
  "wht_applicable" boolean NOT NULL DEFAULT false,
  "wht_rate" numeric(9,4) NOT NULL DEFAULT 0,

  -- Decision 3. 0 means "exactly what was ordered, and not one unit more".
  "receipt_tolerance_percentage" numeric(9,4) NOT NULL DEFAULT 0,

  -- Derived by recalc_purchase_order() from the lines. Written by the trigger
  -- only — the source recomputed these in a pre-save hook, which is how a
  -- document edited by any path that skipped the hook kept totals its own
  -- lines no longer justified (§9.9).
  "subtotal" numeric(19,4) NOT NULL DEFAULT 0,
  "vat_total" numeric(19,4) NOT NULL DEFAULT 0,
  "total" numeric(19,4) NOT NULL DEFAULT 0,

  "delivery_address" text,
  "delivery_instructions" text,
  "notes" text,
  "terms_and_conditions" text,
  "internal_notes" text,

  -- Lifecycle stamps: each answers "when did this become that", each null
  -- until it does. What happened to the outbound EMAIL is in
  -- document_deliveries, not here.
  "sent_at" timestamp with time zone,
  "sent_by_id" text,
  "sent_by_name" text,
  "confirmed_at" timestamp with time zone,
  "confirmed_by_id" text,
  "confirmed_by_name" text,
  "cancelled_at" timestamp with time zone,
  "cancelled_by_id" text,
  "cancelled_by_name" text,
  "cancellation_reason" text,
  -- Closed short: somebody decided no more will arrive against this order.
  -- A judgement, so it records who made it.
  "closed_at" timestamp with time zone,
  "closed_by_id" text,
  "closed_by_name" text,
  "closure_reason" text,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "purchase_orders_supplier_fk"
    FOREIGN KEY ("supplier_id", "company_id")
    REFERENCES "parties"("id", "company_id"),

  CONSTRAINT "purchase_orders_status_valid" CHECK ("status" IN (
    'draft', 'sent', 'confirmed', 'cancelled', 'closed'
  )),

  CONSTRAINT "purchase_orders_company_number_uq" UNIQUE ("company_id", "po_number"),

  -- 0050 and the bill FKs reference (id, company_id), the same composite the
  -- rest of the schema uses so a child row can never cross tenants.
  CONSTRAINT "purchase_orders_id_company_uq" UNIQUE ("id", "company_id"),

  CONSTRAINT "purchase_orders_wht_rate_range"
    CHECK ("wht_rate" >= 0 AND "wht_rate" <= 30),

  -- A tolerance is a percentage, and 100% over is already an absurd amount of
  -- slack — anything past it is a typo, not a policy.
  CONSTRAINT "purchase_orders_tolerance_range"
    CHECK ("receipt_tolerance_percentage" >= 0 AND "receipt_tolerance_percentage" <= 100),

  -- valid_until before po_date is not a short order, it is a typo.
  CONSTRAINT "purchase_orders_valid_until_after_date"
    CHECK ("valid_until" IS NULL OR "valid_until" >= "po_date"),

  -- Cancelling and closing are decisions, and a decision says why.
  CONSTRAINT "purchase_orders_cancelled_has_reason" CHECK (
    ("status" <> 'cancelled') OR ("cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)
  ),
  CONSTRAINT "purchase_orders_closed_has_reason" CHECK (
    ("status" <> 'closed') OR ("closed_at" IS NOT NULL AND "closure_reason" IS NOT NULL)
  )
);--> statement-breakpoint

-- Withholding follows the subtotal, the way commission follows it on a quote
-- (0041). GENERATED, so it moves whenever the lines move and there is nothing
-- to remember. `net_payable` is expressed from the base columns rather than
-- from these two, because a generated column may not reference another.
ALTER TABLE "purchase_orders"
  ADD COLUMN "wht_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    CASE WHEN "wht_applicable"
         THEN ROUND("subtotal" * "wht_rate" / 100, 4)
         ELSE 0 END
  ) STORED;--> statement-breakpoint

ALTER TABLE "purchase_orders"
  ADD COLUMN "net_payable" numeric(19,4)
  GENERATED ALWAYS AS (
    "subtotal" + "vat_total"
    - CASE WHEN "wht_applicable"
           THEN ROUND("subtotal" * "wht_rate" / 100, 4)
           ELSE 0 END
  ) STORED;--> statement-breakpoint

CREATE INDEX "purchase_orders_company_status_idx"
  ON "purchase_orders" ("company_id", "status");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_date_idx"
  ON "purchase_orders" ("company_id", "po_date" DESC);--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx"
  ON "purchase_orders" ("company_id", "supplier_id", "status");--> statement-breakpoint
-- Drives the "what is due in" screen; partial so it stays small as orders
-- close out.
CREATE INDEX "purchase_orders_expected_delivery_idx"
  ON "purchase_orders" ("company_id", "expected_delivery_date")
  WHERE "status" IN ('sent', 'confirmed');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Lines.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,

  -- Null when the line buys something that is not stocked (a service, a
  -- one-off). The snapshot below keeps the line readable when it is, and when
  -- the product is later deleted.
  "product_id" uuid,
  "product_name" text,
  "product_sku" text,

  "description" text NOT NULL,

  -- Where this lands in the books. A live reference on an internal document
  -- (decision 4) — the code and name are joined, not copied.
  "account_id" uuid,

  "quantity" numeric(19,4) NOT NULL,
  "unit" text NOT NULL DEFAULT 'pcs',
  "unit_price" numeric(19,4) NOT NULL,
  "vat_rate" numeric(9,4) NOT NULL DEFAULT 0,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "purchase_order_lines_po_fk"
    FOREIGN KEY ("purchase_order_id", "company_id")
    REFERENCES "purchase_orders"("id", "company_id") ON DELETE CASCADE,

  CONSTRAINT "purchase_order_lines_product_fk"
    FOREIGN KEY ("product_id", "company_id")
    REFERENCES "products"("id", "company_id"),

  CONSTRAINT "purchase_order_lines_account_fk"
    FOREIGN KEY ("account_id", "company_id")
    REFERENCES "accounts"("id", "company_id"),

  CONSTRAINT "purchase_order_lines_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "purchase_order_lines_price_not_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "purchase_order_lines_vat_is_a_percentage"
    CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100),

  CONSTRAINT "purchase_order_lines_number_uq" UNIQUE ("purchase_order_id", "line_number"),

  -- 0050 links goods receipt lines to these through document_flow, which
  -- references the line by id; the composite keeps that link tenant-safe.
  CONSTRAINT "purchase_order_lines_id_company_uq" UNIQUE ("id", "company_id")
);--> statement-breakpoint

CREATE INDEX "purchase_order_lines_po_idx"
  ON "purchase_order_lines" ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_product_idx"
  ON "purchase_order_lines" ("company_id", "product_id")
  WHERE "product_id" IS NOT NULL;--> statement-breakpoint

-- Line arithmetic, computed once and in one place. The source does the same
-- work in JavaScript with Math.round(x * 100) / 100 at each step (§2.1);
-- numeric(19,4) makes it exact and the rounding the database's, consistently.
ALTER TABLE "purchase_order_lines"
  ADD COLUMN "amount" numeric(19,4)
  GENERATED ALWAYS AS ("quantity" * "unit_price") STORED;--> statement-breakpoint

ALTER TABLE "purchase_order_lines"
  ADD COLUMN "vat_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    ROUND("quantity" * "unit_price" * "vat_rate" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "purchase_order_lines"
  ADD COLUMN "line_total" numeric(19,4)
  GENERATED ALWAYS AS (
    "quantity" * "unit_price"
    + ROUND("quantity" * "unit_price" * "vat_rate" / 100, 4)
  ) STORED;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The order's totals follow its lines. Nothing else may write them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_purchase_order() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
BEGIN
  UPDATE purchase_orders po
     SET subtotal   = COALESCE(agg.amount, 0),
         vat_total  = COALESCE(agg.vat, 0),
         total      = COALESCE(agg.amount, 0) + COALESCE(agg.vat, 0),
         updated_at = now()
    FROM (
      SELECT SUM(amount)     AS amount,
             SUM(vat_amount) AS vat
        FROM purchase_order_lines
       WHERE purchase_order_id = target
    ) agg
   WHERE po.id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER recalc_purchase_order_on_line_change
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
FOR EACH ROW EXECUTE FUNCTION recalc_purchase_order();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- An order is only editable while it is a draft.
--
-- The Mongo model exposes this as a `canEdit` virtual that the actions were
-- trusted to consult, which makes it advice rather than a rule. Once an order
-- has been sent, its lines are what the supplier was told to deliver, and
-- changing them silently rewrites the document GR/IR will be matched against.
--
-- Amendments are not blocked — they are a status change back to draft, which
-- is a decision with a name on it, followed by an edit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_lines_are_draft_only() RETURNS trigger AS $$
DECLARE
  v_status text;
  target uuid := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
BEGIN
  SELECT status INTO v_status FROM purchase_orders WHERE id = target;

  -- The order row is already gone: this is the ON DELETE CASCADE clearing its
  -- children, not somebody editing a sent order.
  IF v_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION
      'Purchase order lines cannot be changed once the order leaves draft (status: %). Return it to draft to amend it.',
      v_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER purchase_order_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
FOR EACH ROW EXECUTE FUNCTION purchase_order_lines_are_draft_only();--> statement-breakpoint

-- ============================================================================
-- The deferred references land (§9G, and the note on bills.purchase_order_id).
--
-- 0015 carried `bills.purchase_order_id` and `bill_lines.purchase_order_id` as
-- bare uuids with a comment saying "the FK lands with the table". This is that
-- table. NOT VALID because a fresh deploy has no rows to check and a bill that
-- predates this migration cannot be re-pointed — the constraint applies to
-- everything written from here.
-- ============================================================================
ALTER TABLE "bills"
  ADD CONSTRAINT "bills_purchase_order_fk"
  FOREIGN KEY ("purchase_order_id", "company_id")
  REFERENCES "purchase_orders"("id", "company_id") NOT VALID;--> statement-breakpoint

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_purchase_order_fk"
  FOREIGN KEY ("purchase_order_id", "company_id")
  REFERENCES "purchase_orders"("id", "company_id") NOT VALID;--> statement-breakpoint

-- ============================================================================
-- How much of each PO line has been BILLED — derived, at any chain depth.
--
-- The counterpart to `quote_line_invoiced` (0041), and recursive for the same
-- reason: the chain is not fixed. Today it is PO line -> bill line. A goods
-- receipt line sits between them the moment three-way match is on, and this
-- view does not change when it does.
--
-- A cancelled or rejected bill took nothing and is excluded — which is exactly
-- the case the stored counter got wrong, since nothing decremented it.
-- ============================================================================
CREATE VIEW "purchase_order_line_billed" AS
WITH RECURSIVE descend AS (
  SELECT f.predecessor_id AS po_line_id,
         f.successor_id,
         f.successor_type,
         f.quantity
    FROM document_flow f
   WHERE f.predecessor_type = 'purchase_order_line'

  UNION ALL

  SELECT d.po_line_id,
         f.successor_id,
         f.successor_type,
         f.quantity
    FROM descend d
    JOIN document_flow f ON f.predecessor_id = d.successor_id
)
SELECT pol.id               AS purchase_order_line_id,
       pol.purchase_order_id,
       pol.company_id,
       pol.quantity         AS ordered_quantity,
       COALESCE(SUM(d.quantity) FILTER (
         WHERE d.successor_type = 'bill_line' AND b.id IS NOT NULL
       ), 0)::numeric(19,4)  AS billed_quantity
  FROM purchase_order_lines pol
  LEFT JOIN descend d ON d.po_line_id = pol.id
  LEFT JOIN bill_lines bl
         ON bl.id = d.successor_id AND d.successor_type = 'bill_line'
  LEFT JOIN bills b
         ON b.id = bl.bill_id AND b.status NOT IN ('cancelled', 'rejected')
 GROUP BY pol.id, pol.purchase_order_id, pol.company_id, pol.quantity;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders', 'purchase_order_lines']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_order_lines" TO app_user;--> statement-breakpoint
GRANT SELECT ON "purchase_order_line_billed" TO app_user;
