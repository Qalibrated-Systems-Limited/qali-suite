-- ============================================================================
-- 0016 — Bills and credit notes: tenant-composite keys, header totals derived
-- from the lines, the exact overpay/over-application invariants, snapshot
-- immutability, and RLS.
--
-- This closes the AP side of docs/POSTGRES-MIGRATION-PLAN.md §9.6 step 3, and
-- closes the TODO left in 0012: payment allocations could name a bill that did
-- not exist, because the table did not exist.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tenant-composite foreign keys.
--
--    A plain FK on id alone lets a row in tenant A reference a row in tenant B.
--    Referencing (id, company_id) makes cross-tenant references unrepresentable
--    rather than merely unlikely.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_id_company_uq" UNIQUE ("id", "company_id");
--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_id_company_uq" UNIQUE ("id", "company_id");
--> statement-breakpoint

ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_tenant_fk"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_tenant_fk"
  FOREIGN KEY ("bill_id", "company_id") REFERENCES "bills"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_account_tenant_fk"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "bill_lines" DROP CONSTRAINT IF EXISTS "bill_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_weighbridge_tenant_fk"
  FOREIGN KEY ("weighbridge_ticket_id", "company_id") REFERENCES "weighbridge_tickets"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_tenant_fk"
  FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_tenant_fk"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_note_tenant_fk"
  FOREIGN KEY ("credit_note_id", "company_id") REFERENCES "credit_notes"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "credit_note_lines" DROP CONSTRAINT IF EXISTS "credit_note_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- The invoice line a credit line credits. Replaces Mongo's `originalItemIndex`,
-- an ordinal into an embedded array that silently repoints when a line is
-- removed.
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_original_line_tenant_fk"
  FOREIGN KEY ("original_invoice_line_id", "company_id") REFERENCES "invoice_lines"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bill header amounts are a function of the lines.
--
--    bill.js recomputes subtotal/vat/wht/netPayable/balance in a pre-save hook
--    (bill.js:560-606). Any write that does not go through document.save() —
--    updateOne, findOneAndUpdate, bulkWrite, a migration script — leaves the
--    header disagreeing with its own lines, and the header is what every
--    report reads.
--
--    total, net_payable and balance are generated columns, so only subtotal,
--    vat_amount and wht_amount need maintaining, and this is the only thing
--    that maintains them: the repository does not pass them.
--
--    Opening-balance bills are the documented exception (bill.js:564) — they
--    carry no lines and their gross amount is set directly, so the recompute
--    would zero them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_bill_totals(p_bill_id uuid) RETURNS void AS $$
DECLARE
  v_subtotal numeric(19,4);
  v_vat      numeric(19,4);
BEGIN
  IF (SELECT is_opening_balance FROM bills WHERE id = p_bill_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(l.amount), 0), COALESCE(SUM(l.vat_amount), 0)
    INTO v_subtotal, v_vat
    FROM bill_lines l WHERE l.bill_id = p_bill_id;

  UPDATE bills
     SET subtotal   = v_subtotal,
         vat_amount = v_vat,
         -- WHT is charged on the net of VAT, per bill.js:587.
         wht_amount = CASE WHEN wht_applicable
                           THEN ROUND(v_subtotal * wht_rate / 100, 4)
                           ELSE 0 END,
         updated_at = now()
   WHERE id = p_bill_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_bill_lines_recalc() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_bill_totals(COALESCE(NEW.bill_id, OLD.bill_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bill_lines_recalc_totals
  AFTER INSERT OR UPDATE OR DELETE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION trg_bill_lines_recalc();
--> statement-breakpoint

-- Changing the WHT terms re-derives the withholding from the same lines.
CREATE OR REPLACE FUNCTION trg_bill_wht_recalc() RETURNS trigger AS $$
BEGIN
  IF NEW.wht_applicable IS DISTINCT FROM OLD.wht_applicable
     OR NEW.wht_rate IS DISTINCT FROM OLD.wht_rate THEN
    PERFORM recalc_bill_totals(NEW.id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bills_recalc_on_wht_change
  AFTER UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION trg_bill_wht_recalc();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. §9.2 — payment status is a function of what has been paid.
--
--    bill.js:1324 sets `balance = 0` whenever |balance| < 0.01 and then reads
--    `balance <= 0` to decide "paid", so a bill 0.9 cents short reports as
--    settled. balance is exact here, and the status is computed from it rather
--    than assigned alongside it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_bill_payment_status() RETURNS trigger AS $$
DECLARE
  v_net numeric(19,4) := NEW.subtotal + NEW.vat_amount - NEW.wht_amount;
BEGIN
  NEW.payment_status := CASE
    WHEN NEW.amount_paid = 0     THEN 'unpaid'
    WHEN NEW.amount_paid < v_net THEN 'partial'
    WHEN NEW.amount_paid = v_net THEN 'paid'
    ELSE 'overpaid'  -- unreachable: bills_not_overpaid rejects it first
  END::payment_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bills_set_payment_status
  BEFORE INSERT OR UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION trg_bill_payment_status();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A bill's amount_paid comes from its allocations.
--
--    Mongo keeps an embedded `payments[]` array on the bill AND a Payment
--    document with its own allocations — two records of the same event that
--    are updated by different code paths (§8.2). Here there is one: the
--    allocation. amount_paid follows it, so "paid according to the bill" and
--    "paid according to the payments" cannot diverge, and the CHECK
--    (balance >= 0) turns bill.js:1302's `balance + 0.01` into an exact refusal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_bill_amount_paid(p_bill_id uuid) RETURNS void AS $$
BEGIN
  UPDATE bills b
     SET amount_paid = COALESCE((
           SELECT SUM(a.amount_allocated)
             FROM payment_allocations a
            WHERE a.document_type = 'bill' AND a.document_id = b.id
         ), 0),
         updated_at = now()
   WHERE b.id = p_bill_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_allocation_bill_amount_paid() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.document_type = 'bill' THEN
    PERFORM recalc_bill_amount_paid(OLD.document_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.document_type = 'bill' THEN
    PERFORM recalc_bill_amount_paid(NEW.document_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER payment_allocations_maintain_bill_paid
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION trg_allocation_bill_amount_paid();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Closes the TODO in 0012.
--
--    trg_allocation_document_exists could not validate a bill allocation
--    because `bills` did not exist, so it accepted them unchecked. It exists
--    now, and the same rule applies to both sides.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_allocation_document_exists() RETURNS trigger AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NEW.document_type = 'invoice' THEN
    SELECT EXISTS (
      SELECT 1 FROM invoices i
       WHERE i.id = NEW.document_id AND i.company_id = NEW.company_id
    ) INTO v_exists;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM bills b
       WHERE b.id = NEW.document_id AND b.company_id = NEW.company_id
    ) INTO v_exists;
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION
      'Allocation references % % which does not exist in this company',
      NEW.document_type, NEW.document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Credit note header amounts are a function of the lines — as in 2.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_credit_note_totals(p_note_id uuid) RETURNS void AS $$
BEGIN
  UPDATE credit_notes n
     SET subtotal   = COALESCE((SELECT SUM(l.amount)     FROM credit_note_lines l WHERE l.credit_note_id = n.id), 0),
         tax_amount = COALESCE((SELECT SUM(l.tax_amount) FROM credit_note_lines l WHERE l.credit_note_id = n.id), 0),
         updated_at = now()
   WHERE n.id = p_note_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_credit_note_lines_recalc() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_credit_note_totals(COALESCE(NEW.credit_note_id, OLD.credit_note_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER credit_note_lines_recalc_totals
  AFTER INSERT OR UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_lines_recalc();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. §9.4 — the supplier, account and customer details are snapshots.
--
--    "Cached at bill creation time (won't change if supplier updates)"
--    (bill.js:234), "Cached for display" (bill.js:69-70), "cached from invoice"
--    (creditNote.js:63). All three read as caches and are not: they are what
--    the document said. Refusing the update is what makes the difference
--    enforceable rather than a comment.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_bill_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.supplier_id             IS DISTINCT FROM OLD.supplier_id
     OR NEW.supplier_name_at_bill    IS DISTINCT FROM OLD.supplier_name_at_bill
     OR NEW.supplier_tax_pin_at_bill IS DISTINCT FROM OLD.supplier_tax_pin_at_bill
  THEN
    RAISE EXCEPTION
      'supplier snapshot columns are immutable: they record what bill % said when it was raised',
      OLD.bill_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bills_snapshot_is_immutable
  BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION trg_bill_snapshot_immutable();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_bill_line_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.account_id            IS DISTINCT FROM OLD.account_id
     OR NEW.account_code_at_bill IS DISTINCT FROM OLD.account_code_at_bill
     OR NEW.account_name_at_bill IS DISTINCT FROM OLD.account_name_at_bill
     OR NEW.account_type         IS DISTINCT FROM OLD.account_type
  THEN
    RAISE EXCEPTION
      'account snapshot columns on bill lines are immutable: they record what the line was charged to'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bill_lines_snapshot_is_immutable
  BEFORE UPDATE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION trg_bill_line_snapshot_immutable();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_credit_note_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.invoice_id                IS DISTINCT FROM OLD.invoice_id
     OR NEW.invoice_number_at_issue  IS DISTINCT FROM OLD.invoice_number_at_issue
     OR NEW.invoice_total_at_issue   IS DISTINCT FROM OLD.invoice_total_at_issue
     OR NEW.customer_id              IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_name_at_issue   IS DISTINCT FROM OLD.customer_name_at_issue
  THEN
    RAISE EXCEPTION
      'invoice/customer snapshot columns are immutable: they record what credit note % was raised against',
      OLD.credit_note_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER credit_notes_snapshot_is_immutable
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_snapshot_immutable();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Line-count invariants, checked at COMMIT.
--
--    "Bill must have at least one line" and "no more than 50" are Mongoose
--    array validators (bill.js:266-284); the credit note has the same rule
--    (creditNote.js:196). They are deferred because a bill is inserted before
--    its lines are, so the header is legitimately empty mid-transaction.
--
--    A bill with no lines and no opening-balance flag posts a zero-value
--    payable — which is exactly the state the Mongo validator exists to refuse.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_bill_line_count(p_bill_id uuid) RETURNS void AS $$
DECLARE
  v_count   integer;
  v_opening boolean;
  v_number  text;
BEGIN
  SELECT is_opening_balance, bill_number INTO v_opening, v_number
    FROM bills WHERE id = p_bill_id;
  IF NOT FOUND THEN RETURN; END IF;  -- deleted in this transaction

  SELECT COUNT(*) INTO v_count FROM bill_lines WHERE bill_id = p_bill_id;

  IF v_count = 0 AND NOT v_opening THEN
    RAISE EXCEPTION 'Bill % must have at least one line', v_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_count > 50 THEN
    RAISE EXCEPTION 'Bill % cannot have more than 50 lines (has %)', v_number, v_count
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Two functions rather than one branching on TG_TABLE_NAME: plpgsql resolves
-- NEW.<field> when the statement executes, so a single function referencing
-- both NEW.id and NEW.bill_id fails on whichever table lacks the other.
CREATE OR REPLACE FUNCTION trg_bill_asserts_line_count() RETURNS trigger AS $$
BEGIN
  PERFORM assert_bill_line_count(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_bill_line_asserts_line_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_bill_line_count(OLD.bill_id);
  ELSE
    PERFORM assert_bill_line_count(NEW.bill_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER bills_have_lines
  AFTER INSERT OR UPDATE ON bills
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_bill_asserts_line_count();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER bill_lines_count_within_bounds
  AFTER INSERT OR UPDATE OR DELETE ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_bill_line_asserts_line_count();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION assert_credit_note_valid(p_note_id uuid) RETURNS void AS $$
DECLARE
  v_count  integer;
  v_total  numeric(19,4);
  v_number text;
BEGIN
  SELECT total, credit_note_number INTO v_total, v_number
    FROM credit_notes WHERE id = p_note_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_count FROM credit_note_lines WHERE credit_note_id = p_note_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Credit note % must have at least one line', v_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- creditNote.js:222 — `total: min [0.01]`. A zero-value credit note is a
  -- document that credits nothing.
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Credit note % must credit a positive amount', v_number
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_credit_note_is_valid() RETURNS trigger AS $$
BEGIN
  PERFORM assert_credit_note_valid(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_credit_note_line_keeps_note_valid() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_credit_note_valid(OLD.credit_note_id);
  ELSE
    PERFORM assert_credit_note_valid(NEW.credit_note_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER credit_notes_are_valid
  AFTER INSERT OR UPDATE ON credit_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_is_valid();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER credit_note_lines_keep_note_valid
  AFTER INSERT OR UPDATE OR DELETE ON credit_note_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_line_keeps_note_valid();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. AP aging from the subledger.
--
--    reports.ts already ages AP off the general ledger, by party, from the
--    accounts_payable control account. This ages it off the bills themselves,
--    so the two can be reconciled — a subledger that disagrees with its control
--    account is precisely what the §6.3 cutover reconciliation looks for.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "bill_aging" WITH (security_invoker = true) AS
SELECT
  b.company_id,
  b.id            AS bill_id,
  b.bill_number,
  b.supplier_id,
  b.supplier_name_at_bill,
  b.bill_date,
  b.due_date,
  b.net_payable,
  b.amount_paid,
  b.balance,
  GREATEST(0, (CURRENT_DATE - b.due_date))::integer AS days_overdue,
  CASE
    WHEN CURRENT_DATE <= b.due_date          THEN 'current'
    WHEN CURRENT_DATE - b.due_date <= 30     THEN '1-30'
    WHEN CURRENT_DATE - b.due_date <= 60     THEN '31-60'
    WHEN CURRENT_DATE - b.due_date <= 90     THEN '61-90'
    ELSE '90+'
  END AS aging_bucket
FROM bills b
WHERE b.status = 'approved' AND b.balance > 0;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RLS.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bills', 'bill_lines', 'credit_notes', 'credit_note_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;
