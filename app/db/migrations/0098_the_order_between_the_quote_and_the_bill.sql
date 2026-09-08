-- ─────────────────────────────────────────────────────────────────────────────
-- 0098 — The order between the quote and the bill.
--
-- Sales orders. `lib/unported-modules.js` switched this module OFF rather than
-- porting it, and it is the only feature in the app that is deliberately dark.
-- Four failures were listed there, of which one was loud and three were quiet:
--
--   sales-order-actions.js:56   ObjectId.isValid(quoteId) on a Postgres uuid
--   sales-order-actions.js:64   read the MONGO Quote collection
--   sales-order-actions.js:187  committed stock against MONGO Product counters
--   sales-order-actions.js:392  Invoice.create — a MONGO invoice
--
-- The note said relaxing the id check alone would move the failure from step
-- one to step four, where it is invisible. That was right, and this is the
-- port it asked for.
--
-- WHY THE DOCUMENT EXISTS AT ALL. A quote is an offer; an invoice is a bill.
-- Between them is the moment the customer says yes, and that moment is worth a
-- record because two things start at it: the stock is RESERVED, so a confirmed
-- order cannot be sold out from under itself, and the sum of confirmed orders
-- not yet invoiced is the ORDER BACKLOG — committed revenue that is not yet
-- billed, which nothing else in this system can answer.
--
-- ── Decision 1 — THE LINEAGE IS document_flow, NOT TWO REF COLUMNS ────────
--
-- The Mongo model embedded `quoteRef` and `invoiceRef`. 0041 built
-- `document_flow` for exactly this, and said so in its own comment: "every ERP
-- that models selling properly puts an ORDER between them — SAP quote → order
-- → delivery → invoice … and this codebase already has a salesOrder model
-- waiting. A column named quote_id on invoices encodes 'an invoice comes from
-- a quote', which stops being true the moment the order step lands."
--
-- 'sales_order' and 'sales_order_line' have been in that table's CHECK
-- constraints since 0041, unused, waiting for this migration. And
-- `quote_line_invoiced` is RECURSIVE precisely so that the chain growing from
-- quote line → invoice line into quote line → ORDER line → invoice line needs
-- no change to it. Nothing in this migration touches that view; the tests
-- prove it follows the longer chain anyway.
--
-- So there are no ref columns here. The screens still read `order.quoteRef`
-- and `order.invoiceRef`, and the repository assembles those from the flow
-- rows — the shape stays, the storage is a relationship.
--
-- ── Decision 2 — THE COMMITMENT IS THE STATUS, NOT A FLAG BESIDE IT ───────
--
-- Mongo kept `stockCommitted` on each line and flipped it on confirm, on
-- cancel and on conversion, with a comment explaining that exactly one
-- document line must own a given reservation at any moment. The rule is right.
-- A boolean maintained by four code paths is not how to hold it: the flag and
-- the status can disagree, and when they do the stock is either double-held or
-- silently free, with nothing to say which.
--
-- Here a sales order holds a commitment for each of its product lines when,
-- and only when, its status is 'confirmed'. There is no column: the reads
-- derive it, and the transitions do the commit and the release inside one
-- transaction. It cannot drift because there is nothing to drift from.
--
-- ── Decision 3 — CONVERSION RELEASES BEFORE IT COMMITS ────────────────────
--
-- On Postgres a draft invoice commits stock for every inventory product line
-- as it is created (`createInvoice` → `commitStock`) — unconditionally, with
-- no flag to carry over. So converting an order cannot "transfer ownership" by
-- flipping booleans as Mongo did; the invoice takes its own commitment.
--
-- Which means the ORDER must let go first. `products_commitments_within_on_hand`
-- is a plain CHECK, evaluated per statement and not deferred, so committing
-- the invoice's copy while the order still holds its own would raise on a
-- fully-committed product. Both happen in one transaction, so no other session
-- ever sees the gap, and the row lock means none can take the stock in it.
--
-- ── Decision 4 — THE PREFIX IS CONFIGURABLE, LIKE EVERY OTHER DOCUMENT ────
--
-- `document_prefix()` falls through to `upper(p_kind)` for a kind it does not
-- know, so 'sales_order' would have numbered orders SALES_ORDER-00001. An arm
-- and a `sales_order_prefix` column, defaulting to 'SO', which is the shape
-- invoice / bill / quote / po / grn already have.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "company_settings"
  ADD COLUMN "sales_order_prefix" text NOT NULL DEFAULT 'SO';--> statement-breakpoint

CREATE OR REPLACE FUNCTION document_prefix(p_company_id uuid, p_kind text)
RETURNS text AS $$
DECLARE
  v_prefix text;
BEGIN
  SELECT CASE p_kind
           WHEN 'invoice'     THEN s.invoice_prefix
           WHEN 'bill'        THEN s.bill_prefix
           WHEN 'quote'       THEN s.quote_prefix
           WHEN 'po'          THEN s.po_prefix
           WHEN 'grn'         THEN s.grn_prefix
           WHEN 'sales_order' THEN s.sales_order_prefix
         END
    INTO v_prefix
    FROM company_settings s
   WHERE s.company_id = p_company_id;

  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := CASE p_kind
                  WHEN 'invoice'     THEN 'INV'
                  WHEN 'bill'        THEN 'BILL'
                  WHEN 'quote'       THEN 'QT'
                  WHEN 'po'          THEN 'PO'
                  WHEN 'grn'         THEN 'GRN'
                  WHEN 'sales_order' THEN 'SO'
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- SALES ORDERS
--
-- Totals are DERIVED — recalc_sales_order() owns subtotal, discount_total,
-- tax_total and total, exactly as recalc_quote() owns the quote's. An order
-- whose stored total disagrees with its own lines is the defect that pattern
-- exists to prevent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "order_number" text NOT NULL,

  "customer_id" uuid NOT NULL,
  -- What the customer was told, at the time. See §9.4 on snapshots.
  "customer_name" text NOT NULL,
  "customer_email" text,
  "customer_phone" text,
  "customer_address" text,
  "customer_tax_pin" text,

  "order_date" date NOT NULL,
  "expected_delivery_date" date,
  "status" text NOT NULL DEFAULT 'draft',

  "title" text,
  "notes" text,
  "currency" text NOT NULL DEFAULT 'KES',

  /* Derived by trigger. Read these; never write them. */
  "subtotal" numeric(19,4) NOT NULL DEFAULT 0,
  "discount_total" numeric(19,4) NOT NULL DEFAULT 0,
  "tax_total" numeric(19,4) NOT NULL DEFAULT 0,
  "total" numeric(19,4) NOT NULL DEFAULT 0,

  /* Who sold it — carried quote → order → invoice. Without it here the chain
     drops the rep in the middle and Sales by Rep (0095) loses every deal that
     went through an order. */
  "salesperson_party_id" uuid REFERENCES "parties"("id") ON DELETE SET NULL,
  "salesperson_name" text,

  "confirmed_at" timestamp with time zone,
  "confirmed_by_id" text,
  "confirmed_by_name" text,
  "invoiced_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by_id" text,
  "cancelled_by_name" text,
  "cancellation_reason" text,

  "created_by_id" text,
  "created_by_name" text NOT NULL DEFAULT 'System',
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "sales_orders_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "parties"("id"),

  CONSTRAINT "sales_orders_status_valid" CHECK ("status" IN (
    'draft', 'confirmed', 'invoiced', 'cancelled'
  )),

  /* Each state carries the moment it reached it, and a state that has not
     been reached carries nothing. In Mongo confirmedAt and cancelledAt were
     free-floating dates that a status change was not obliged to set, so
     "confirmed" with no confirmation time was a reachable row.

     NOT an equivalence, which is what this was first written as and what a
     test caught: cancelling a CONFIRMED order leaves it cancelled while it
     genuinely was confirmed at a particular moment, and erasing that to
     satisfy the constraint would be destroying the history the column exists
     to hold. A draft has never been confirmed; a confirmed or invoiced order
     has; a cancelled one may or may not have been, and the row says which. */
  CONSTRAINT "sales_orders_confirmation_pair" CHECK (
    CASE "status"
      WHEN 'draft'     THEN "confirmed_at" IS NULL
      WHEN 'confirmed' THEN "confirmed_at" IS NOT NULL
      WHEN 'invoiced'  THEN "confirmed_at" IS NOT NULL
      ELSE true
    END
  ),
  CONSTRAINT "sales_orders_cancellation_pair" CHECK (
    ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)
  ),
  CONSTRAINT "sales_orders_invoiced_pair" CHECK (
    ("status" = 'invoiced') = ("invoiced_at" IS NOT NULL)
  ),

  /* The same pair rule 0095 put on invoices: an id brings its snapshot. */
  CONSTRAINT "sales_orders_salesperson_pair" CHECK (
    "salesperson_party_id" IS NULL OR "salesperson_name" IS NOT NULL
  ),

  CONSTRAINT "sales_orders_company_number_uq" UNIQUE ("company_id", "order_number")
);--> statement-breakpoint

/* The list, filtered by status, newest first — the only query it makes. */
CREATE INDEX "sales_orders_company_status_date_idx"
  ON "sales_orders" ("company_id", "status", "order_date" DESC);--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" ("company_id", "customer_id");--> statement-breakpoint
CREATE INDEX "sales_orders_salesperson_idx"
  ON "sales_orders" ("salesperson_party_id") WHERE "salesperson_party_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- SALES ORDER LINES
--
-- Every amount GENERATED, discount before tax, because tax is charged on what
-- is payable. Identical arithmetic to quote_lines so a quote converting to an
-- order cannot change a figure by being re-rounded in JavaScript on the way.
--
-- There is no `stock_committed` and no `invoiced_quantity`. The first is
-- decision 2; the second is what `document_flow` already answers, at any chain
-- depth, which is why `quote_lines` does not carry one either.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "sales_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,

  "item_type" text NOT NULL,
  "service_category" text,

  -- Null for a service line, and for a product since deleted: the snapshot
  -- below is what keeps the line readable either way.
  "product_id" uuid,
  "product_name" text,
  "product_sku" text,

  "description" text,
  "unit" text,
  "quantity" numeric(19,4) NOT NULL,
  "unit_price" numeric(19,4) NOT NULL,
  "discount_percentage" numeric(9,4) NOT NULL DEFAULT 0,
  "tax_rate" numeric(9,4) NOT NULL DEFAULT 0,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "sales_order_lines_product_fk"
    FOREIGN KEY ("product_id", "company_id")
    REFERENCES "products"("id", "company_id"),

  CONSTRAINT "sales_order_lines_item_type_valid"
    CHECK ("item_type" IN ('product', 'service')),

  CONSTRAINT "sales_order_lines_product_has_product" CHECK (
    ("item_type" = 'product' AND "product_id" IS NOT NULL)
    OR ("item_type" = 'service' AND "service_category" IS NOT NULL)
  ),

  CONSTRAINT "sales_order_lines_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "sales_order_lines_price_not_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "sales_order_lines_discount_is_a_percentage"
    CHECK ("discount_percentage" >= 0 AND "discount_percentage" <= 100),
  CONSTRAINT "sales_order_lines_tax_is_a_percentage"
    CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100),

  CONSTRAINT "sales_order_lines_number_uq" UNIQUE ("sales_order_id", "line_number")
);--> statement-breakpoint

CREATE INDEX "sales_order_lines_order_idx" ON "sales_order_lines" ("sales_order_id");--> statement-breakpoint

ALTER TABLE "sales_order_lines"
  ADD COLUMN "gross_amount" numeric(19,4)
  GENERATED ALWAYS AS ("quantity" * "unit_price") STORED;--> statement-breakpoint

ALTER TABLE "sales_order_lines"
  ADD COLUMN "discount_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "sales_order_lines"
  ADD COLUMN "net_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    "quantity" * "unit_price"
    - ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "sales_order_lines"
  ADD COLUMN "tax_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    ROUND(
      ("quantity" * "unit_price"
        - ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4))
      * "tax_rate" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "sales_order_lines"
  ADD COLUMN "line_total" numeric(19,4)
  GENERATED ALWAYS AS (
    "quantity" * "unit_price"
    - ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4)
    + ROUND(
        ("quantity" * "unit_price"
          - ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4))
        * "tax_rate" / 100, 4)
  ) STORED;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The totals belong to the lines. Same shape as recalc_quote().
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_sales_order() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.sales_order_id, OLD.sales_order_id);
BEGIN
  UPDATE sales_orders so
     SET subtotal       = COALESCE(agg.net, 0),
         discount_total = COALESCE(agg.disc, 0),
         tax_total      = COALESCE(agg.tax, 0),
         total          = COALESCE(agg.net, 0) + COALESCE(agg.tax, 0),
         updated_at     = now()
    FROM (
      SELECT SUM(net_amount)      AS net,
             SUM(discount_amount) AS disc,
             SUM(tax_amount)      AS tax
        FROM sales_order_lines
       WHERE sales_order_id = target
    ) agg
   WHERE so.id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER recalc_sales_order_on_line_change
AFTER INSERT OR UPDATE OR DELETE ON "sales_order_lines"
FOR EACH ROW EXECUTE FUNCTION recalc_sales_order();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_orders', 'sales_order_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "sales_orders" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sales_order_lines" TO app_user;
