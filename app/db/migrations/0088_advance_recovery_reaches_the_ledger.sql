-- ─────────────────────────────────────────────────────────────────────────────
-- Advance recovery reaches the ledger.
--
-- THE DEFECT. `computeCertificate` has always worked out how much of the
-- advance a certificate recovers — `min(pct × gross, advance paid)` — and it
-- correctly reduces what the employer pays. Nothing ever journalled it.
--
-- The consequence, on a job with a 10,000,000 advance recovered at 20%:
--
--   cert 1   gross 20,000,000   recovers 4,000,000   AR overstated by 4,000,000
--   cert 2   gross 35,000,000   recovers 7,000,000   AR overstated by 7,000,000
--
-- and the advance sits as a liability at its full 10,000,000 for the life of
-- the contract, long after the work that earned it was certified. Receivables
-- overstated, liabilities overstated, and the two never clear each other.
--
-- What posts, once this is in place — beside the retention split, on the other
-- side of the balance sheet:
--
--     DR Customer Advance      /  CR Accounts Receivable
--
-- Not revenue and not a discount: the certificate is still worth its gross,
-- and output VAT was already accounted on that gross. The employer simply pays
-- less cash because part of it was paid before the work started.
--
-- WHY THIS MIGRATION EXISTS AT ALL. `2190 Customer Advance` is already in the
-- chart of accounts seed with the `customer_advance` handle, so companies
-- created recently have it. Companies created before it was added do not — the
-- dev database has one. Same situation 0085 found for 1125, same remedy: add
-- it where it is missing, per company, and leave every company that has one
-- untouched.
--
-- Idempotent by the NOT EXISTS, and matched on EITHER the code or the handle
-- so a company that mapped its own account to `customer_advance` under a
-- different code does not get a duplicate.
--
-- ON PARENTING. 0085 picked its parent by account code alone — `1100` for the
-- retention account — which assumes every company runs the standard chart.
-- They do not. A company whose chart is flat, or which uses 2100 for something
-- of its own, gets the new account filed under whatever happens to hold that
-- code: on this repo's dev database, `2100` is WHT Payable, and an earlier cut
-- of this migration duly parented Customer Advance underneath it.
--
-- So the parent must be a header, not merely a code: a non-postable liability
-- at 2100 or 2000, preferring the more specific. Where a company has neither,
-- the account sits at the root of its chart — which is right for a flat chart
-- and is at least not wrong for any other.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO accounts (
  company_id, account_code, account_name, account_type, sub_type,
  can_post, system_account, parent_id, description, is_active, level
)
SELECT c.id,
       '2190',
       'Customer Advance',
       'liability',
       'customer_deposit',
       true,
       'customer_advance',
       (SELECT p.id FROM accounts p
         WHERE p.company_id = c.id
           AND p.account_type = 'liability'
           AND p.can_post = false
           AND p.account_code IN ('2100', '2000')
         ORDER BY p.account_code DESC LIMIT 1),
       'Money the customer paid before the work was done — advance payments, deposits and overpayments. Cleared as certificates recover it.',
       true,
       COALESCE(
         (SELECT p.level + 1 FROM accounts p
           WHERE p.company_id = c.id
             AND p.account_type = 'liability'
             AND p.can_post = false
             AND p.account_code IN ('2100', '2000')
           ORDER BY p.account_code DESC LIMIT 1),
         1)
  FROM companies c
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts a
    WHERE a.company_id = c.id
      AND (a.account_code = '2190' OR a.system_account = 'customer_advance')
 );

-- Repair, for a database that already ran an earlier cut of this migration or
-- of 0085: a system account whose parent is a POSTABLE account was filed by
-- code rather than by structure. Detach it rather than guess again — the root
-- of the chart is where an unparented account belongs, and it is visible there
-- rather than hidden under an unrelated payable.
UPDATE accounts a
   SET parent_id = NULL,
       level = 1
  FROM accounts p
 WHERE p.id = a.parent_id
   AND p.can_post = true
   AND a.system_account IN ('customer_advance', 'retention_receivable');
