-- ─────────────────────────────────────────────────────────────────────────────
-- 0085 — Two accounts, so project cost can reach the ledger.
--
-- 0084 made the project a DIMENSION on `journal_lines`. This is the other half:
-- there were two things a project does that posted NOTHING, and a dimension on
-- an entry nobody makes is still nothing.
--
-- ── What was missing, and why it matters ────────────────────────────────────
--
-- 1. STOCK ISSUED TO A JOB POSTED NOTHING. `recordMovement`, `issueStock` and
--    `createCheckout` each insert a row and none creates a journal entry —
--    while a bill for an inventory purchase DEBITS Inventory. So material
--    bought for a job and issued to it was relieved from stock in QUANTITY and
--    never in the LEDGER, leaving Inventory overstated by every item ever
--    issued to a project and the job's largest cost line invisible to the
--    accounts.
--
--    Both comparisons post this. SAP issues goods to a WBS element against a
--    consumption account; Odoo's stock moves hit the valuation accounts in real
--    time. There is no reading of standard practice where this stays unposted.
--
--    The account already existed: `5410 Project Materials`, under `5400 Direct
--    Project Costs`. It simply had no `system_account` handle, so nothing could
--    look it up. That is all that was wrong with it.
--
-- 2. RETENTION HAD NOWHERE TO GO. `project_certificates` computes retention
--    held, released and outstanding, and the register says on its own page that
--    the figure does not reach the ledger. It needs a receivable.
--
--    `1125 Retention Receivable`, beside `1120 Accounts Receivable`. NOT 1250 —
--    the plan said 1250 "does not exist in the chart" and that was wrong; 1250
--    is Computer Equipment. 1125 is free and sits where a reader looks for it.
--
--    And it is a RECEIVABLE, not a reduction of revenue. The work was done and
--    the income is earned; what is deferred is payment of part of it. Booking
--    retention as less revenue would understate income for the life of the job
--    and overstate it when the retention is released.
--
-- ── Why a migration and not just the chart file ─────────────────────────────
--
-- `lib/chart-of-accounts.js` seeds a NEW company. Every company that already
-- exists has its chart, and editing the seed does nothing for them. So this
-- adds 1125 where it is missing and stamps the handle on 5410 — per company,
-- idempotently, and without touching a chart anybody has customised beyond
-- those two rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- `5410 Project Materials` exists in every chart this seed has ever produced;
-- it just had no handle. Claim it only where the code matches and nothing else
-- already holds the handle.
UPDATE accounts a
   SET system_account = 'project_materials'
 WHERE a.account_code = '5410'
   AND a.system_account IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM accounts b
      WHERE b.company_id = a.company_id
        AND b.system_account = 'project_materials'
   );--> statement-breakpoint

-- Retention Receivable, for every company that does not have one. Parented to
-- Current Assets where that exists, so it lands in the right place in the tree
-- rather than at the root.
INSERT INTO accounts (
  company_id, account_code, account_name, account_type, sub_type,
  can_post, system_account, parent_id, description, is_active, level
)
SELECT c.id,
       '1125',
       'Retention Receivable',
       'asset',
       'receivable',
       true,
       'retention_receivable',
       (SELECT p.id FROM accounts p
         WHERE p.company_id = c.id AND p.account_code = '1100' LIMIT 1),
       'Money certified as earned but held back by the employer until the works are taken over and the defects period ends.',
       true,
       COALESCE(
         (SELECT p.level + 1 FROM accounts p
           WHERE p.company_id = c.id AND p.account_code = '1100' LIMIT 1),
         1)
  FROM companies c
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts a
    WHERE a.company_id = c.id
      AND (a.account_code = '1125' OR a.system_account = 'retention_receivable')
 );
