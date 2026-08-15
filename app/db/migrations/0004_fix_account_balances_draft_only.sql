-- ============================================================================
-- 0004 — Fix: accounts whose only lines belong to draft entries vanished from
-- account_balances entirely, instead of reporting a zero balance.
--
-- 0002 filtered rows out in the WHERE clause:
--
--   LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
--   WHERE l.id IS NULL OR e.id IS NOT NULL
--
-- For an account with lines that all belong to drafts, `l.id` is NOT NULL but
-- `e.id` IS NULL, so every one of its rows was discarded and the GROUP BY
-- produced no row at all. The account disappeared from the chart of accounts
-- as far as any balance report was concerned — worse than showing a wrong
-- number, because nothing signals the omission.
--
-- The fix is to stop filtering rows and instead only let posted lines
-- contribute to the sums. Every account now appears exactly once, whether or
-- not it has any posted activity.
-- ============================================================================

CREATE OR REPLACE VIEW "account_balances" AS
SELECT
  a.id                AS account_id,
  a.company_id,
  a.account_code,
  a.account_name,
  a.account_type,
  a.system_account,
  a.is_active,
  a.can_post,
  COALESCE(SUM(l.debit)  FILTER (WHERE e.id IS NOT NULL), 0)::numeric(19,4) AS total_debit,
  COALESCE(SUM(l.credit) FILTER (WHERE e.id IS NOT NULL), 0)::numeric(19,4) AS total_credit,
  CASE
    WHEN a.account_type IN ('asset', 'expense')
      THEN COALESCE(SUM(l.debit)  FILTER (WHERE e.id IS NOT NULL), 0)
         - COALESCE(SUM(l.credit) FILTER (WHERE e.id IS NOT NULL), 0)
    ELSE COALESCE(SUM(l.credit) FILTER (WHERE e.id IS NOT NULL), 0)
       - COALESCE(SUM(l.debit)  FILTER (WHERE e.id IS NOT NULL), 0)
  END::numeric(19,4) AS balance
FROM accounts a
LEFT JOIN journal_lines l
       ON l.account_id = a.id
LEFT JOIN journal_entries e
       ON e.id = l.entry_id
      AND e.status = 'posted'
GROUP BY a.id, a.company_id, a.account_code, a.account_name,
         a.account_type, a.system_account, a.is_active, a.can_post;
