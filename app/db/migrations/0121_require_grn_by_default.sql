-- ============================================================================
-- THREE-WAY MATCH IS THE DEFAULT — 0121
--
-- `company_settings.require_grn` has existed since 0015 and defaulted to
-- false. It was also never read: `approveBill` takes a `requireGRN` option,
-- defaults it to false, and no caller passed one until now. So for every
-- tenant, on every bill, an inventory line posted
--
--     DR Inventory   CR Accounts Payable
--
-- and put the goods on the shelf at invoice approval. The goods receipt note —
-- with its dual Sales/Finance signature, its line-level accept and reject, its
-- NCR on a discrepancy and its GR/IR clearing — was optional, and in practice
-- unused, because nothing required it.
--
-- WHY THE DEFAULT FLIPS RATHER THAN STAYING AN OPTION. Every ERP above SMB
-- bookkeeping debits inventory at the RECEIPT and clears it with the invoice;
-- that is what the name GR/IR means. SAP's MIRO cannot debit inventory for a
-- stock material at all. Odoo cannot receive stock from a vendor bill. Oracle
-- makes receipt accrual mandatory for inventory items. The pattern this
-- codebase shipped with — inventory from the invoice — is the QuickBooks
-- simplification, and it is the wrong one for a system that already has a
-- purchase order module, a receiving workflow and a clearing account.
--
-- What it buys, in the order it costs money:
--
--   PERIOD ACCURACY   goods in on 30 September against an invoice dated 5
--                     October belong to September. Bill-driven books them in
--                     October, every month, in both directions.
--   SEGREGATION       whoever takes the delivery is not whoever approves the
--                     invoice. Bill-driven collapses both into one approval.
--   DISCREPANCIES     short delivery, over-billing and price variance become
--                     visible as GR/IR positions instead of surfacing at
--                     stocktake.
--
-- IT APPLIES TO STOCK LINES ONLY, which the application already gets right:
-- `isInventoryPurchase` is `productId AND account_type = 'asset'`, so services,
-- rent and consumables still post direct. Even SAP two-way matches services.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Nobody may be switched on without somewhere to defer to.
--
--    With the flag on, `approveBill` REFUSES an inventory bill when no GR/IR
--    account is mapped — deliberately, rather than falling back to direct
--    posting and defeating the control. One of the companies on this
--    deployment has no `grni` account, so flipping the default without this
--    would turn "three-way match" into "inventory bills cannot be approved".
--
--    Only where it is missing, and by SYSTEM ACCOUNT rather than by code: a
--    code is a label a company chooses, and on that same company 2100 is WHT
--    Payable rather than the current-liability parent the standard chart uses.
--    The code is therefore the first unused one in the 217x band, and the row
--    is created at root level — `seedChartOfAccounts` is not re-runnable, so
--    this backfills the one account rather than replaying the chart.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO accounts (
  id, company_id, account_code, account_name, account_type, sub_type,
  can_post, system_account, description, is_active, level, path
)
SELECT gen_random_uuid(),
       c.id,
       free.code,
       'GR/IR Clearing',
       'liability',
       'accrual',
       true,
       'grni',
       'Goods received not invoiced — cleared when the supplier bill is approved.',
       true,
       0,
       free.code::ltree
  FROM companies c
  CROSS JOIN LATERAL (
    SELECT v.code
      FROM (VALUES ('2175'), ('2176'), ('2177'), ('2178'), ('2179')) AS v(code)
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts a
        WHERE a.company_id = c.id AND a.account_code = v.code
     )
     ORDER BY v.code
     LIMIT 1
  ) AS free
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts a
    WHERE a.company_id = c.id AND a.system_account = 'grni'
 );--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The default, for every company created from here on.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "company_settings"
  ALTER COLUMN "require_grn" SET DEFAULT true;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. And for the companies that already exist.
--
--    A default alone changes nothing for anybody already here, and "the
--    control is on for tenants created after Tuesday" is not a control. Safe
--    to apply now because it only governs bills approved FROM NOW ON: an
--    already-approved bill has posted and is untouched, and a bill still in
--    draft or submitted has posted nothing yet.
--
--    What it does change is that an inventory bill now waits for its goods
--    receipt. That is the point, and it is the thing to tell people before
--    they meet it — a bill that used to put stock on the shelf now books to
--    GR/IR and shows up under "Invoice received, goods pending" on the
--    reconciliation screen until the GRN is accepted.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "company_settings" SET "require_grn" = true WHERE "require_grn" = false;--> statement-breakpoint
