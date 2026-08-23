-- ============================================================================
-- 0061 — Opening balances.
--
-- `opening-balance-actions.js:161` posts the cutover journal entry through the
-- Mongo JournalEntry model while every ledger screen reads Postgres. Six
-- exported functions in 481 lines: the lump entry, the conversion date, an
-- opening invoice, an opening bill, and a reversal for each.
--
-- ── The half that already existed, and did not work ─────────────────────────
--
-- `app/db/repositories/bills.ts:295` has `createOpeningBalanceBill`, written
-- during the bills port. NOTHING CALLS IT — and it only inserts the row. No
-- path posts the Dr Opening Balance Equity / Cr Accounts Payable entry that
-- makes an opening payable mean anything, and `approveBill` does not special-
-- case `is_opening_balance`. So the Postgres half of this module looks
-- finished from a file listing and would have produced a payable the trial
-- balance never saw.
--
-- That is §9L's third question answered from the other direction: not a screen
-- calling the Mongo half, but a repository function with no caller at all.
-- Worth adding to the sweep — an exported repository function that nothing
-- imports is either dead or an unfinished port, and both are worth knowing.
--
-- ── This migration ──────────────────────────────────────────────────────────
--
-- Only one column. `bills` has carried `is_opening_balance` since the bills
-- port; `invoices` never got it, so an opening receivable could not be
-- distinguished from a real sale — which matters because the two post
-- differently (Dr AR / Cr OBE, versus Dr AR / Cr Revenue with COGS and VAT)
-- and because the reversal path must refuse anything that is not an opening
-- document.
--
-- The partial index is the guard that matters in practice: opening documents
-- are read as a set, exactly once, on a screen used during onboarding.
-- ============================================================================

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "is_opening_balance" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE INDEX "invoices_opening_balance_idx"
  ON "invoices" ("company_id", "invoice_date")
  WHERE "is_opening_balance";--> statement-breakpoint

CREATE INDEX "bills_opening_balance_idx"
  ON "bills" ("company_id", "bill_date")
  WHERE "is_opening_balance";
