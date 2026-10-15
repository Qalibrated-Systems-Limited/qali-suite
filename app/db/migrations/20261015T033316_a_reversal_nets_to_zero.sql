-- ============================================================================
-- A REVERSAL NETS TO ZERO
--
-- Reversing an entry posted a swapped copy and then set the ORIGINAL to
-- status = 'reversed'. Every ledger report counts status = 'posted' only, so
-- the original dropped out and the swapped copy stayed in: a cancelled bill of
-- 1,000 showed as an expense of -1,000 and a 1,000 debit on Accounts Payable,
-- instead of nothing. The MongoDB app had the same defect, and it is in a live
-- tenant's books (a bill cancelled in October 2026).
--
-- The fix is the model SAP and Odoo use: the original stays POSTED, the
-- reversal is posted beside it, both count, and they net to zero. "Reversed"
-- becomes a flag on the original (reversed_at / reversal_entry_id), not a
-- status. reverseJournalEntry stops changing the status, and the journal
-- screens show "Reversed" from the flag.
--
-- The 'reversed' enum value stays (dropping an enum value is a rewrite of the
-- type, and old code may still name it); nothing writes it any more.
--
-- THE FISCAL GUARD. trg_resolve_fiscal_period ran on every UPDATE of a posted
-- entry, so flagging an entry in a closed period as reversed was refused, even
-- though the reversal itself posts today into an open period, which is the
-- correct practice. It now enforces the period only when an entry BECOMES
-- posted, or when a posted entry's date or company changes. A flag update on
-- an entry that was already posted is not a posting.
--
-- SAFE TO APPLY because: the UPDATE below only changes reversed -> posted on
-- rows that already count as posted for balancing (journal_entries_must_balance
-- treats both alike), and the guard change only removes refusals.
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_resolve_fiscal_period() RETURNS trigger AS $$
DECLARE
  v_period  fiscal_periods%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('posted', 'reversed') THEN
    RETURN NEW;
  END IF;

  -- Already posted, same date, same company: not a posting, nothing to guard.
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('posted', 'reversed')
     AND OLD.entry_date = NEW.entry_date
     AND OLD.company_id = NEW.company_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period
  FROM fiscal_periods p
  WHERE p.company_id = NEW.company_id
    AND NEW.entry_date BETWEEN p.start_date AND p.end_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_period.status IN ('closed', 'locked') THEN
    RAISE EXCEPTION
      'Cannot post entry % into % fiscal period %',
      NEW.entry_number, v_period.status, v_period.period_name
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.fiscal_period_id := v_period.id;
  NEW.fiscal_year      := v_period.year;
  NEW.fiscal_month     := v_period.month;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

UPDATE journal_entries
   SET status = 'posted',
       reversed_at = COALESCE(reversed_at, updated_at)
 WHERE status = 'reversed';
