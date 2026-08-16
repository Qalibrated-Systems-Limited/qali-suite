-- ============================================================================
-- 0006 — Bring parties under the same guarantees as the accounting core, and
-- close the referential gap left by 0000.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. journal_entries.party_id was a bare uuid referencing nothing.
--
--    An entry could name a party that did not exist, or — worse — one belonging
--    to a different tenant, and nothing would object. The composite key makes
--    the tenant boundary part of referential integrity, the same way
--    journal_lines already references its entry and account.
--
--    ON DELETE RESTRICT, not CASCADE: deleting a customer must never silently
--    delete their invoices' journal entries. Deactivate instead.
--
--    NOTE FOR BACKFILL: parties must be loaded BEFORE journal entries, or this
--    constraint rejects the entries. app/db/backfill/backfill.mjs already maps
--    party ids into _migration_id_map under 'parties'; it must now also insert
--    the rows.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "parties" ADD CONSTRAINT "parties_id_company_uq" UNIQUE ("id", "company_id");
--> statement-breakpoint

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_party_tenant_fk"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Row-Level Security, same policy shape as the accounting core.
--    FORCE is required or the table owner bypasses it entirely.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "parties"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Party balances, derived.
--
--    app/models/parties.js carries `cachedBalance` with the comment
--    "Cached - NOT source of truth!" — an accurate description of a field that
--    can silently disagree with the ledger. It is not carried over. This view
--    computes the same number from the AR/AP control accounts instead, so it
--    cannot go stale.
--
--    Sign convention matches the Mongo comment:
--      positive = they owe us (AR)
--      negative = we owe them (AP)
--
--    security_invoker so RLS is evaluated as the querying role rather than the
--    view's owner — without it the view would return every tenant's balances.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "party_balances" WITH (security_invoker = true) AS
SELECT
  p.id            AS party_id,
  p.company_id,
  p.name,
  p.primary_type,
  COALESCE(SUM(
    CASE
      -- Receivable-side movement: debits increase what they owe us.
      WHEN a.system_account = 'accounts_receivable' THEN  l.debit - l.credit
      -- Payable-side movement: credits increase what we owe them, hence the
      -- negation to keep one signed column.
      WHEN a.system_account = 'accounts_payable'    THEN -(l.credit - l.debit)
      ELSE 0
    END
  ), 0)::numeric(19,4) AS balance
FROM parties p
LEFT JOIN journal_entries e
       ON e.party_id = p.id
      AND e.status = 'posted'
LEFT JOIN journal_lines l
       ON l.entry_id = e.id
LEFT JOIN accounts a
       ON a.id = l.account_id
      AND a.system_account IN ('accounts_receivable', 'accounts_payable')
GROUP BY p.id, p.company_id, p.name, p.primary_type;
