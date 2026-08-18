-- ============================================================================
-- 0027 — invoices.cogs_entry_id.
--
-- completeInvoice posted the revenue entry and nothing else. The stock left,
-- the cost was computed and written to cogs_postings, and no journal entry
-- moved the value: cost of sales stayed at zero and inventory stayed on the
-- balance sheet. Measured on a sale of 10 at 250 costing 40 each:
--
--     AR              2500.0000
--     Sales          -2500.0000
--     COGS ledger        0        <- should be 400
--     Inventory ldgr     0        <- should be -400
--     cogs_postings    400.0000   <- the cost WAS recorded, in the subledger
--     stock on hand     90        <- the goods DID leave
--
-- Gross profit overstated by the whole cost of every sale, inventory
-- overstated by the same. The books still balanced, which is why nothing
-- complained — migration 0001 refuses an UNBALANCED entry, but a missing one
-- is silent.
--
-- Mongo posts it (invoice.js:1499, "DEBIT: Cost of Goods Sold (always)") and
-- tracks it as accounting.cogsJournalEntryId. This is the column for it, so a
-- completed invoice can be traced to both entries it raised.
-- ============================================================================

ALTER TABLE "invoices" ADD COLUMN "cogs_entry_id" uuid;
--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cogs_entry_id_journal_entries_id_fk"
  FOREIGN KEY ("cogs_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT;
