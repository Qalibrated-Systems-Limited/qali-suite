-- ============================================================================
-- 0041 — Quotes.
--
-- The document that precedes an invoice. Ported now, ahead of larger modules,
-- because the invoice port BROKE it: every invoice surface reads Postgres,
-- while quote.convertToInvoice() still wrote a Mongo invoice and redirected to
-- a Postgres page with a 24-character ObjectId. §9E has the detail.
--
-- Three decisions carried over from earlier steps rather than re-argued:
--
--   TOTALS DERIVE FROM LINES (§9.9). The source keeps subtotal, tax and total
--   on the quote and recomputes them in application code somebody has to
--   remember to call — which is how stock_requests came to store 399.96 for a
--   request whose items sum to 799.97. Here a trigger owns them, so the number
--   on the quote is the number its lines justify, always.
--
--   `invoiced_quantity` IS NOT STORED (§9.3). The source keeps a counter per
--   line and increments it on conversion. What it means is "how much of this
--   line has been invoiced", which the invoice lines already say. A counter
--   beside the rows that justify it is a second source of truth, and the two
--   drift the first time an invoice is cancelled. A view derives it instead.
--
--   SNAPSHOTS STAY (§9.4). product_name and product_sku are what the customer
--   was quoted. Renaming a product must not silently rewrite a document that
--   has already been sent.
-- ============================================================================

CREATE TABLE "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "quote_number" text NOT NULL,

  -- The customer is a real reference, not a name. Composite, so a quote can
  -- never point at another tenant's party — parties(id, company_id) is unique
  -- since 0005, and admin paths that run privileged are not covered by RLS.
  "customer_id" uuid NOT NULL,

  -- What the customer was told they were dealing with, at the time. Kept
  -- alongside the reference for the same reason invoice lines keep theirs.
  "customer_name" text NOT NULL,
  "customer_email" text,
  "customer_phone" text,
  "customer_address" text,

  "quote_date" date NOT NULL,
  "valid_until" date,
  "status" text NOT NULL DEFAULT 'draft',

  "title" text,
  "notes" text,
  "internal_notes" text,
  "terms" text,
  "reference" text,
  "currency" text NOT NULL DEFAULT 'KES',

  -- Derived by recalc_quote() from the lines. Written by the trigger only.
  "subtotal" numeric(19,4) NOT NULL DEFAULT 0,
  "discount_total" numeric(19,4) NOT NULL DEFAULT 0,
  "tax_total" numeric(19,4) NOT NULL DEFAULT 0,
  "total" numeric(19,4) NOT NULL DEFAULT 0,

  -- Lifecycle stamps. Each is the answer to "when did this become that", and
  -- each is null until it does.
  -- When the user pressed send. What happened to the OUTBOUND EMAIL is not
  -- here — see document_deliveries below.
  "sent_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "accepted_by_name" text,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text,
  "converted_at" timestamp with time zone,

  -- ── WHO SOLD IT ───────────────────────────────────────────────────────────
  -- A reference, the way SAP carries partner function VE, NetSuite a Sales Rep
  -- and Odoo a user_id on the order. The name is snapshotted beside it because
  -- it was printed on what the customer received (§9.4).
  "salesperson_party_id" uuid,
  "salesperson_name" text,
  "salesperson_employee_number" text,

  -- The agreed rate for THIS deal. The amount is not stored — see below.
  "commission_rate" numeric(9,4) NOT NULL DEFAULT 0,

  "created_by_id" text,
  "created_by_name" text,
  "created_by_role" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "quotes_customer_fk"
    FOREIGN KEY ("customer_id", "company_id")
    REFERENCES "parties"("id", "company_id"),

  CONSTRAINT "quotes_salesperson_fk"
    FOREIGN KEY ("salesperson_party_id", "company_id")
    REFERENCES "parties"("id", "company_id"),

  CONSTRAINT "quotes_commission_is_a_percentage"
    CHECK ("commission_rate" >= 0 AND "commission_rate" <= 100),

  CONSTRAINT "quotes_status_valid" CHECK ("status" IN (
    'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'
  )),

  -- A quote number is unique WITHIN a tenant, never globally: two companies
  -- both starting at QUO-0001 is normal.
  CONSTRAINT "quotes_company_number_uq" UNIQUE ("company_id", "quote_number"),

  -- valid_until before quote_date is not a short quote, it is a typo.
  CONSTRAINT "quotes_valid_until_after_date"
    CHECK ("valid_until" IS NULL OR "valid_until" >= "quote_date")
);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Commission follows the subtotal. It is not a number anybody types.
--
-- The source computes `salesPerson.commission.amount` in a pre-save hook, from
-- subtotal x rate, and stores it — so a quote edited by any path that does not
-- re-run the hook keeps a commission for a total it no longer has. Every ERP
-- that takes commission seriously derives it: NetSuite from Commission Plans
-- against realised revenue, SAP through settlement, Odoo from its plans. The
-- RATE is the agreed term and belongs on the deal; the AMOUNT is arithmetic.
--
-- GENERATED from subtotal, which the recalc trigger maintains — so it moves
-- whenever the lines move, with nothing to remember.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "quotes"
  ADD COLUMN "commission_amount" numeric(19,4)
  GENERATED ALWAYS AS (ROUND("subtotal" * "commission_rate" / 100, 4)) STORED;--> statement-breakpoint

CREATE INDEX "quotes_salesperson_idx"
  ON "quotes" ("salesperson_party_id") WHERE "salesperson_party_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "quotes_company_status_idx" ON "quotes" ("company_id", "status");--> statement-breakpoint
CREATE INDEX "quotes_company_date_idx" ON "quotes" ("company_id", "quote_date" DESC);--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" ("customer_id");--> statement-breakpoint

CREATE TABLE "quote_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,

  "item_type" text NOT NULL,
  "service_category" text,

  -- Null for a service line, and for a product that has since been deleted:
  -- the snapshot below is what keeps the line readable either way.
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

  CONSTRAINT "quote_lines_product_fk"
    FOREIGN KEY ("product_id", "company_id")
    REFERENCES "products"("id", "company_id"),

  CONSTRAINT "quote_lines_item_type_valid"
    CHECK ("item_type" IN ('product', 'service')),

  -- A product line names a product; a service line names a category. The
  -- source enforced this in a pre-save hook, which is a rule the database can
  -- simply not permit to be broken.
  CONSTRAINT "quote_lines_product_has_product" CHECK (
    ("item_type" = 'product' AND "product_id" IS NOT NULL)
    OR ("item_type" = 'service' AND "service_category" IS NOT NULL)
  ),

  CONSTRAINT "quote_lines_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "quote_lines_price_not_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "quote_lines_discount_is_a_percentage"
    CHECK ("discount_percentage" >= 0 AND "discount_percentage" <= 100),
  CONSTRAINT "quote_lines_tax_is_a_percentage"
    CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100),

  CONSTRAINT "quote_lines_number_uq" UNIQUE ("quote_id", "line_number")
);--> statement-breakpoint

CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" ("quote_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Line amounts, computed once and in one place.
--
-- GENERATED, not stored by the application: discount then tax, in that order,
-- because tax is charged on what is actually payable. The source does the same
-- thing in JavaScript with Math.round(x * 100) / 100 on each step, which is
-- §2.1 — numeric(19,4) here means the arithmetic is exact and the rounding is
-- the database's, consistently.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "quote_lines"
  ADD COLUMN "gross_amount" numeric(19,4)
  GENERATED ALWAYS AS ("quantity" * "unit_price") STORED;--> statement-breakpoint

ALTER TABLE "quote_lines"
  ADD COLUMN "discount_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "quote_lines"
  ADD COLUMN "net_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    "quantity" * "unit_price"
    - ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "quote_lines"
  ADD COLUMN "tax_amount" numeric(19,4)
  GENERATED ALWAYS AS (
    ROUND(
      ("quantity" * "unit_price"
        - ROUND("quantity" * "unit_price" * "discount_percentage" / 100, 4))
      * "tax_rate" / 100, 4)
  ) STORED;--> statement-breakpoint

ALTER TABLE "quote_lines"
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
-- The quote's totals follow its lines. Nothing else may write them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_quote() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.quote_id, OLD.quote_id);
BEGIN
  UPDATE quotes q
     SET subtotal       = COALESCE(agg.net, 0),
         discount_total = COALESCE(agg.disc, 0),
         tax_total      = COALESCE(agg.tax, 0),
         total          = COALESCE(agg.net, 0) + COALESCE(agg.tax, 0),
         updated_at     = now()
    FROM (
      SELECT SUM(net_amount)      AS net,
             SUM(discount_amount) AS disc,
             SUM(tax_amount)      AS tax
        FROM quote_lines
       WHERE quote_id = target
    ) agg
   WHERE q.id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER recalc_quote_on_line_change
AFTER INSERT OR UPDATE OR DELETE ON "quote_lines"
FOR EACH ROW EXECUTE FUNCTION recalc_quote();--> statement-breakpoint

-- The link an invoice line keeps back to the quote line it came from. Nullable
-- because most invoice lines have no quote behind them.
ALTER TABLE "invoice_lines"
  ADD COLUMN "quote_line_id" uuid REFERENCES "quote_lines"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "invoice_lines_quote_line_idx"
  ON "invoice_lines" ("quote_line_id") WHERE "quote_line_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN "quote_id" uuid REFERENCES "quotes"("id") ON DELETE SET NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- How much of each quote line has been invoiced — derived, not counted.
--
-- The source increments quote_lines.invoicedQuantity on conversion. This asks
-- the invoice lines instead, so cancelling an invoice cannot leave a quote
-- claiming it was fully invoiced. Only completed and draft invoices count; a
-- cancelled one took nothing.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "quote_line_invoiced" AS
SELECT ql.id            AS quote_line_id,
       ql.quote_id      AS quote_id,
       ql.company_id    AS company_id,
       ql.quantity      AS quoted_quantity,
       COALESCE(SUM(il.quantity), 0)::numeric(19,4) AS invoiced_quantity
  FROM quote_lines ql
  LEFT JOIN invoice_lines il
         ON il.quote_line_id = ql.id
  LEFT JOIN invoices i
         ON i.id = il.invoice_id AND i.status <> 'cancelled'
 GROUP BY ql.id, ql.quote_id, ql.company_id, ql.quantity;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- What happened to a document we emailed.
--
-- The source keeps sentTo, deliveredAt, deliveryAttempts and lastDeliveryError
-- ON THE QUOTE, which is four columns describing something that is not the
-- quote — and which cannot answer "what happened on the second attempt", since
-- each send overwrites the last. No ERP models it that way: SAP has output
-- management with its own status records, NetSuite a communication log on the
-- record, Odoo mail.message tracking. All of them keep one row per attempt.
--
-- One row per attempt here too, and generic over the document, because an
-- invoice, a purchase order and a statement are all emailed by the same code
-- and would otherwise each grow their own four columns.
--
--   attempts        = count of rows
--   last error      = the newest failed row
--   delivered_at    = the newest delivered row
--
-- all derived, none stored twice.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "document_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  -- Not a foreign key: this table serves every document type, and a column per
  -- type would be one nullable FK per document and a CHECK to keep exactly one
  -- of them populated. The pair is indexed instead.
  "document_type" text NOT NULL,
  "document_id" uuid NOT NULL,

  "recipient" text NOT NULL,
  "status" text NOT NULL,
  "provider" text,
  "provider_message_id" text,
  "error" text,
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone,
  "attempted_by_id" text,
  "attempted_by_name" text,

  CONSTRAINT "document_deliveries_type_valid" CHECK ("document_type" IN (
    'quote', 'invoice', 'bill', 'credit_note', 'purchase_order', 'statement'
  )),
  CONSTRAINT "document_deliveries_status_valid" CHECK ("status" IN (
    'queued', 'sent', 'delivered', 'failed', 'bounced'
  )),
  -- A delivered row says when. Anything else has not been delivered.
  CONSTRAINT "document_deliveries_delivered_has_time" CHECK (
    ("status" = 'delivered' AND "delivered_at" IS NOT NULL)
    OR ("status" <> 'delivered' AND "delivered_at" IS NULL)
  ),
  -- A failure says why; a success does not pretend to.
  CONSTRAINT "document_deliveries_failure_has_reason" CHECK (
    ("status" IN ('failed', 'bounced') AND "error" IS NOT NULL)
    OR ("status" NOT IN ('failed', 'bounced'))
  )
);--> statement-breakpoint

CREATE INDEX "document_deliveries_document_idx"
  ON "document_deliveries" ("company_id", "document_type", "document_id", "attempted_at" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'quote_lines', 'document_deliveries']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "quotes" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "quote_lines" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "document_deliveries" TO app_user;--> statement-breakpoint
GRANT SELECT ON "quote_line_invoiced" TO app_user;
