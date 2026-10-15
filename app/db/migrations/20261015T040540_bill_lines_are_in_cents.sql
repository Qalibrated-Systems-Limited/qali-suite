-- ============================================================================
-- BILL LINES ARE IN CENTS
--
-- A bill line's amount and VAT were generated to four decimals:
-- 4,310.34 at 16% gave VAT of 689.6544. The MongoDB app rounds each line to
-- the cent (bill.js: amount and VAT per line, then summed), and so do the
-- journal entries it posted, so every migrated bill with a non-round amount
-- disagreed with its own entry by a fraction of a cent. A bill paid in full
-- was left with a balance of 0.0044 and showed as partially paid.
--
-- It is also simply the currency: a supplier invoices VAT in cents, KRA
-- records it in cents, and a payable of 4,999.9944 cannot be paid.
--
-- Now each line rounds its amount and its VAT to the cent, and the bill sums
-- the rounded lines, exactly as the source did. WHT, charged on the subtotal,
-- rounds to the cent too. A generated column cannot read another, so the line
-- amount's expression is repeated in the two that depend on it.
--
-- SAFE TO APPLY because: line values change by under half a cent. Only bills
-- not yet posted have their totals re-derived; a posted bill keeps the totals
-- its journal entry was raised from, since moving one side alone would open
-- exactly the gap this closes.
-- ============================================================================

ALTER TABLE bill_lines
  DROP COLUMN line_total,
  DROP COLUMN vat_amount,
  DROP COLUMN amount;
--> statement-breakpoint

ALTER TABLE bill_lines
  ADD COLUMN amount numeric(19,4)
    GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,
  ADD COLUMN vat_amount numeric(19,4)
    GENERATED ALWAYS AS (ROUND(ROUND(quantity * unit_price, 2) * vat_rate / 100, 2)) STORED,
  ADD COLUMN line_total numeric(19,4)
    GENERATED ALWAYS AS (
      ROUND(quantity * unit_price, 2)
      + ROUND(ROUND(quantity * unit_price, 2) * vat_rate / 100, 2)
    ) STORED;
--> statement-breakpoint

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
         -- WHT is charged on the net of VAT, per bill.js:587, in cents.
         wht_amount = CASE WHEN wht_applicable
                           THEN ROUND(v_subtotal * wht_rate / 100, 2)
                           ELSE 0 END,
         updated_at = now()
   WHERE id = p_bill_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

SELECT recalc_bill_totals(id) FROM bills WHERE status IN ('draft', 'submitted');
