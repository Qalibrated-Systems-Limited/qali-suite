-- ─────────────────────────────────────────────────────────────────────────────
-- 0097 — An invoice remembers who sold it.
--
-- The last screen in `reports` still reading Mongo is Sales by Rep, and it
-- could not be ported: it groups invoices by `salesPerson.employeeId`, and the
-- Postgres `invoices` table HAS NO SALESPERSON AT ALL.
--
-- ── The dimension exists. It is lost at the door ───────────────────────────
--
-- `quotes` carries `salesperson_party_id`, `salesperson_name` and
-- `salesperson_employee_number`, and a commission rate beside them. So the
-- system knows who sold the deal, right up to the moment the deal becomes an
-- invoice — `convertQuoteToInvoice` maps the customer, the lines, the
-- discounts and the dates, and drops the rep.
--
-- That is why the report had to be checked rather than transcribed. Porting
-- the query faithfully against a column that does not exist would have
-- produced a report that returns one row, "Unattributed", for every invoice
-- ever raised — and looks like it is working.
--
-- ── Decision 1 — A PARTY, NOT A USER ──────────────────────────────────────
--
-- Mongo indexed `salesPerson.employeeId` against `User`. The Postgres quote
-- already answers with a PARTY, and a party is the right answer: a rep who
-- leaves keeps their invoices, and a commission is owed to a person the
-- company has a relationship with, not to a login. `parties` is also where
-- `employees` points.
--
-- The screen's drill-down changes shape with it — it filtered by employee id
-- and now filters by party id. That is a caller change and not a silent one.
--
-- ── Decision 2 — THE NAME IS A SNAPSHOT ───────────────────────────────────
--
-- `salesperson_name` beside the id, exactly as `supplier_name_at_bill` and
-- `account_code_at_budget`. A rep who marries, or whose party record is
-- corrected, must not rewrite the name on invoices raised last year — and a
-- report grouped by id but LABELLED from a live join would do that on every
-- render.
--
-- ── Decision 3 — NO COMMISSION COLUMN, YET ────────────────────────────────
--
-- The quote holds a commission RATE and generates the amount (0041). Copying
-- either onto the invoice would be storing a figure with no writer beyond this
-- one path and no screen that reads it — the `financials` mistake from 0070.
-- The rate is on the quote, and the invoice points at the quote. When there is
-- a commission report to pay people from, that is the migration to write.
--
-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Every invoice raised from a quote takes the quote's rep. Invoices raised
-- directly have none and correctly report as unattributed — nothing else is
-- knowable, and inventing one would be worse than the empty bucket.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "invoices"
  ADD COLUMN "salesperson_party_id" uuid,
  ADD COLUMN "salesperson_name" text;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_salesperson_party_id_parties_id_fk" FOREIGN KEY ("salesperson_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- An id with no name is a row the report can group and cannot label.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_salesperson_pair"
  CHECK ("salesperson_party_id" IS NULL OR "salesperson_name" IS NOT NULL);--> statement-breakpoint

-- The report's own index: this tenant, this rep, these statuses, by date.
-- Mirrors the Mongo index the query was written against.
CREATE INDEX "invoices_salesperson_idx"
  ON "invoices" USING btree ("company_id", "salesperson_party_id", "status", "invoice_date")
  WHERE "salesperson_party_id" IS NOT NULL;--> statement-breakpoint

-- Every invoice that came from a quote takes that quote's rep. It is the only
-- history there is.
--
-- THE LINK IS IN `document_flow`, not on the invoice: `invoices` has no
-- `quote_id`, and the conversion records a `quote -> invoice` edge instead.
-- Writing this against a column that felt like it ought to exist would have
-- backfilled nothing and reported success.
UPDATE "invoices" i
   SET "salesperson_party_id" = q."salesperson_party_id",
       "salesperson_name"     = q."salesperson_name"
  FROM "document_flow" f
  JOIN "quotes" q ON q."id" = f."predecessor_id"
 WHERE f."successor_id"    = i."id"
   AND f."predecessor_type" = 'quote'
   AND f."successor_type"   = 'invoice'
   AND i."salesperson_party_id" IS NULL
   AND q."salesperson_party_id" IS NOT NULL
   AND q."salesperson_name" IS NOT NULL;
