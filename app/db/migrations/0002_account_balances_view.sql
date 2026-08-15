-- ============================================================================
-- 0002 — Balances become derived, not stored.
--
-- The Mongo Account document carries `currentBalance` / `balanceUpdatedAt`,
-- refreshed by JournalEntry.updateAccountBalances(). That call is invoked as
-- `.catch(console.error)` — fire-and-forget, outside the transaction — so any
-- failure silently leaves the cached balance disagreeing with the ledger, with
-- nothing to detect the drift.
--
-- Here the balance is computed from the ledger every time. It cannot go stale
-- because it is never stored.
-- ============================================================================

-- security_invoker makes the view evaluate RLS as the *querying* role.
-- Without it (the default) the view runs as its owner and would hand back
-- every tenant's balances — exactly the leak 0001 exists to prevent.
CREATE VIEW "account_balances" WITH (security_invoker = true) AS
SELECT
  a.id                AS account_id,
  a.company_id,
  a.account_code,
  a.account_name,
  a.account_type,
  a.system_account,
  a.is_active,
  a.can_post,
  COALESCE(SUM(l.debit),  0)::numeric(19,4) AS total_debit,
  COALESCE(SUM(l.credit), 0)::numeric(19,4) AS total_credit,
  -- Normal balance side is a function of account type, mirroring the
  -- normalBalanceSide virtual: assets and expenses are debit-normal.
  CASE
    WHEN a.account_type IN ('asset', 'expense')
      THEN COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
    ELSE COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0)
  END::numeric(19,4) AS balance
FROM accounts a
LEFT JOIN journal_lines l
       ON l.account_id = a.id
LEFT JOIN journal_entries e
       ON e.id = l.entry_id
      AND e.status = 'posted'
-- Lines belonging to draft/reversed entries must not contribute; the join
-- above keeps them out, but the WHERE below is what discards their rows
-- entirely rather than counting them as zero.
WHERE l.id IS NULL OR e.id IS NOT NULL
GROUP BY a.id, a.company_id, a.account_code, a.account_name,
         a.account_type, a.system_account, a.is_active, a.can_post;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Trial balance — the reconciliation target for the pilot-tenant cutover.
-- Postgres totals must equal the Mongo trial balance exactly, to the cent.
-- Any variance is the float drift from the old Number columns surfacing, and
-- needs an explicit accounting decision rather than a rounding fudge.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "trial_balance" WITH (security_invoker = true) AS
SELECT
  ab.company_id,
  ab.account_id,
  ab.account_code,
  ab.account_name,
  ab.account_type,
  -- Presented in the conventional two-column form: a debit-normal account with
  -- a positive balance lands in the debit column, and vice versa.
  CASE WHEN ab.balance > 0 AND ab.account_type IN ('asset', 'expense')
         THEN ab.balance
       WHEN ab.balance < 0 AND ab.account_type NOT IN ('asset', 'expense')
         THEN -ab.balance
       ELSE 0
  END::numeric(19,4) AS debit_balance,
  CASE WHEN ab.balance > 0 AND ab.account_type NOT IN ('asset', 'expense')
         THEN ab.balance
       WHEN ab.balance < 0 AND ab.account_type IN ('asset', 'expense')
         THEN -ab.balance
       ELSE 0
  END::numeric(19,4) AS credit_balance
FROM account_balances ab
WHERE ab.can_post = true;
