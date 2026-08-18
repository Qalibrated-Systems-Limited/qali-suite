-- ============================================================================
-- 0028 — A completed invoice cannot be credited for more than it is worth.
--
-- Found porting credit-note-actions.js rules-first rather than writing the
-- repository from the schema outward. Two rules were missing, and the second
-- carries a float tolerance the §9.2 sweep did not reach because it lives in
-- an ACTION rather than in a model:
--
--     credit-note-actions.js:160
--         if (totalAfterCredit > invoice.total + 0.01) { ... }
--
-- A seventh of exactly the kind §9.2 catalogued — the same shape as
-- payment.js:407 (over-allocate a payment) and bill.js:1302 (overpay a bill).
-- It permits crediting a cent more than the invoice was ever worth, which is
-- negative revenue arriving one rounding at a time.
--
-- Enforced here rather than in the action because the sum spans rows and no
-- CHECK can see them. Deferred so a note and its lines can be inserted a
-- statement at a time — the total is only meaningful once the lines exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION assert_invoice_not_over_credited(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_invoice_total numeric(19,4);
  v_credited      numeric(19,4);
  v_number        text;
BEGIN
  SELECT total, invoice_number INTO v_invoice_total, v_number
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN RETURN; END IF;  -- invoice removed in this transaction

  -- A voided note credits nothing.
  SELECT COALESCE(SUM(total), 0) INTO v_credited
    FROM credit_notes
   WHERE invoice_id = p_invoice_id AND status <> 'void';

  IF v_credited > v_invoice_total THEN
    RAISE EXCEPTION
      'Invoice % over-credited: % credited against a total of %',
      v_number, v_credited, v_invoice_total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_credit_note_within_invoice() RETURNS trigger AS $$
BEGIN
  PERFORM assert_invoice_not_over_credited(
    COALESCE(NEW.invoice_id, OLD.invoice_id)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER credit_notes_within_invoice
  AFTER INSERT OR UPDATE OR DELETE ON credit_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_within_invoice();
--> statement-breakpoint

-- The note's own total is maintained from its lines by the 0016 trigger, so a
-- line changing must re-check the invoice it belongs to as well.
CREATE OR REPLACE FUNCTION trg_credit_note_line_within_invoice() RETURNS trigger AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  SELECT invoice_id INTO v_invoice_id
    FROM credit_notes
   WHERE id = COALESCE(NEW.credit_note_id, OLD.credit_note_id);

  IF FOUND THEN
    PERFORM assert_invoice_not_over_credited(v_invoice_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER credit_note_lines_within_invoice
  AFTER INSERT OR UPDATE OR DELETE ON credit_note_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_credit_note_line_within_invoice();
