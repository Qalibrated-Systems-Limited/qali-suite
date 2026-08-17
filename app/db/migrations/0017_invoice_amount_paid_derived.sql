-- ============================================================================
-- 0017 — invoices.amount_paid becomes derived, like bills.amount_paid.
--
-- Closes the asymmetry recorded in docs/POSTGRES-MIGRATION-PLAN.md §9.7.
--
-- 0016 made a bill's amount_paid a function of its allocations. The invoice
-- side was still maintained by hand, incrementally, in two places:
--
--   payments.ts     allocateToInvoice()  SET amount_paid = amount_paid + X
--   creditNotes.ts  applyCreditNote()    SET amount_paid = amount_paid + X
--
-- Two code paths maintaining one number is the §8.2 defect, and `+= X` never
-- re-reads the truth, so any divergence is permanent rather than self-healing.
-- Removing an allocation left the invoice still claiming the money: measured
-- on a 400.00 allocation, the invoice reported `400.0000 partial` after the
-- allocation row was deleted, against an actual allocated sum of 0.
--
-- Note what an invoice's amount_paid is a function of: BOTH the payments
-- allocated to it AND the credit notes applied against it. The second source is
-- why this is not simply a copy of the bill trigger.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The derivation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_invoice_amount_paid(p_invoice_id uuid) RETURNS void AS $$
BEGIN
  UPDATE invoices i
     SET amount_paid = COALESCE((
           SELECT SUM(a.amount_allocated)
             FROM payment_allocations a
            WHERE a.document_type = 'invoice' AND a.document_id = i.id
         ), 0)
         + COALESCE((
           SELECT SUM(n.amount_applied)
             FROM credit_notes n
            WHERE n.invoice_id = i.id
         ), 0),
         updated_at = now()
   WHERE i.id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. One trigger for both document types, replacing the bill-only one from
--    0016. "The document's amount_paid follows its allocations" is a single
--    rule; it was only bill-shaped because bills were the only side that had
--    a derived amount_paid at the time.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS payment_allocations_maintain_bill_paid ON payment_allocations;
--> statement-breakpoint
DROP FUNCTION IF EXISTS trg_allocation_bill_amount_paid();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_allocation_document_amount_paid() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.document_type = 'bill' THEN
      PERFORM recalc_bill_amount_paid(OLD.document_id);
    ELSE
      PERFORM recalc_invoice_amount_paid(OLD.document_id);
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.document_type = 'bill' THEN
      PERFORM recalc_bill_amount_paid(NEW.document_id);
    ELSE
      PERFORM recalc_invoice_amount_paid(NEW.document_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER payment_allocations_maintain_document_paid
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION trg_allocation_document_amount_paid();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The other source: credit applied against the invoice.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_credit_note_applied_amount() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_invoice_amount_paid(OLD.invoice_id);
  ELSIF TG_OP = 'INSERT' OR NEW.amount_applied IS DISTINCT FROM OLD.amount_applied THEN
    PERFORM recalc_invoice_amount_paid(NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER credit_notes_maintain_invoice_paid
  AFTER INSERT OR UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_applied_amount();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. payment_status follows amount_paid, as it does on bills.
--
--    Both hand-written versions collapsed `>= total` to 'paid', so an invoice
--    paid more than it was worth reported as settled. `overpaid` has been in
--    the payment_status enum since 0007 and nothing has ever set it. There is
--    no CHECK forbidding an over-paid invoice — unlike bills, where
--    CHECK (balance >= 0) refuses it outright — so on this side the state is
--    reachable and the honest thing is to name it rather than round it down to
--    'paid'. Same reasoning as §9.3 on `Math.max(0, ...)`: surfacing beats
--    clamping.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_invoice_payment_status() RETURNS trigger AS $$
BEGIN
  NEW.payment_status := CASE
    WHEN NEW.amount_paid = 0          THEN 'unpaid'
    WHEN NEW.amount_paid < NEW.total  THEN 'partial'
    WHEN NEW.amount_paid = NEW.total  THEN 'paid'
    ELSE 'overpaid'
  END::payment_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoices_set_payment_status
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_payment_status();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reconcile anything already written by the hand-maintained path.
--
--    A no-op on a clean database. On one that has been written to, this is the
--    point at which a divergence between the invoice and its allocations gets
--    corrected — and per §6.3, a variance found here is a finding, not a
--    rounding fudge. The UPDATE reports how many rows it touched.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fixed integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT i.id, i.invoice_number, i.amount_paid AS was,
           COALESCE((SELECT SUM(a.amount_allocated) FROM payment_allocations a
                      WHERE a.document_type = 'invoice' AND a.document_id = i.id), 0)
         + COALESCE((SELECT SUM(n.amount_applied) FROM credit_notes n
                      WHERE n.invoice_id = i.id), 0) AS should_be
      FROM invoices i
  LOOP
    IF r.was IS DISTINCT FROM r.should_be THEN
      RAISE NOTICE 'invoice % amount_paid % -> %', r.invoice_number, r.was, r.should_be;
      PERFORM recalc_invoice_amount_paid(r.id);
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  IF v_fixed > 0 THEN
    RAISE NOTICE '0017 reconciled % invoice(s) whose amount_paid disagreed with their allocations', v_fixed;
  END IF;
END $$;
