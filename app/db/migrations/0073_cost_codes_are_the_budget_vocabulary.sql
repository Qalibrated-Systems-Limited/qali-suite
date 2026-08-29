-- ─────────────────────────────────────────────────────────────────────────────
-- 0073 — A budget is built from cost codes, and a cost code names an account.
--
-- WHAT THE FORM ASKS FOR TODAY. `getExpenseAccountsForCategories` hands the
-- budget form 39 postable expense accounts, ordered by code, and a project
-- manager picks from them. `PROJECT_MANAGE_ROLES` includes `Manager` — an
-- operations role — so the person being asked to read a chart of accounts is
-- precisely the person who does not have one in their head.
--
-- No comparable system does this. They all put a curated list in front of the
-- budget-holder and keep the general ledger behind it:
--
--   Procore, Candy, RIB      cost code (+ cost type), mapped to GL by finance
--   Odoo                     "budgetary position" — a named group of accounts
--   Sage Intacct, Xero       cost category, mapped behind the scenes
--   NetSuite                 accounts, but filtered and budgeted at parent level
--   SAP, Oracle              cost element group / commitment item
--
-- AND THIS SCHEMA ALREADY HAS THE TABLE. `project_cost_codes` — LAB, MAT, EQP
-- — has existed since 0070, is already referenced by claims, bills, expenses
-- and stock requests, has full CRUD in both stores, and **has never had a
-- screen in either of them**. It has one thing missing: it does not say which
-- account it charges. That is what this migration adds.
--
-- ── Four decisions ──────────────────────────────────────────────────────────
--
-- 1. A COST CODE CHARGES EXACTLY ONE EXPENSE ACCOUNT, and finance sets it.
--    Not a group of accounts, as Odoo's budgetary position is: a group means
--    the actual for the group has to be split back across the codes that share
--    it, and there is no non-arbitrary way to do that. One account, and SEVERAL
--    CODES MAY SHARE ONE — "Labour, site" and "Labour, office" both charging
--    6200 Wages is normal and legitimate.
--
-- 2. THE BUDGET LINE'S ACCOUNT IS DERIVED, NOT CHOSEN.
--    `project_budget_lines_derive_account` reads the cost code and writes
--    `account_id` and the code/name snapshot itself. The caller supplies a cost
--    code, an amount and a description; it cannot supply an account that
--    disagrees with the code beside it, because it cannot supply one at all.
--
--    It fires on WRITE only. Re-mapping a cost code later — finance correcting
--    which account LAB charges — does NOT rewrite budget lines already
--    approved against the old one. A budget was signed against an account and
--    the signature refers to that account; the same reasoning as every other
--    snapshot in this schema.
--
-- 3. ONE LINE PER ACCOUNT SURVIVES, and now it has something to say.
--    `project_budget_lines_one_per_account` (0070 decision 6) exists because
--    budget-versus-actual matches actuals BY ACCOUNT — two lines on one
--    account each display the full spend, and the project reads twice as far
--    over budget as it is. Cost codes do not change that: if two codes charge
--    the same account, they cannot both be lines on one budget, and the error
--    says which two and why.
--
--    Matching by cost code instead would allow it, and is where this goes when
--    the claims, bills and expense forms actually SET a cost code. Nothing
--    sets one today — there is no picker on any of those forms — so matching
--    on it now would show every budget line an actual of zero.
--
-- 4. THE ACCOUNT MUST BE A POSTABLE EXPENSE ACCOUNT, checked in the database.
--    The picker has always filtered on `account_type = 'expense' AND can_post`.
--    The COLUMN never did: `project_budget_lines.account_id` is an
--    unrestricted reference to `accounts`, so a bank or receivable account
--    posted to the form saved — and then matched no actual, for ever, in
--    silence. The same shape as the project client in 0072: the picker
--    filtered and nothing underneath it agreed.
-- ─────────────────────────────────────────────────────────────────────────────

-- Both columns are NOT NULL from the start: there are no cost codes and no
-- budget lines in any database, here or in test. Nothing to backfill and no
-- nullable-but-required column to explain later.
ALTER TABLE "project_cost_codes" ADD COLUMN "account_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "project_cost_codes" ADD CONSTRAINT "project_cost_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_cost_codes_account_idx" ON "project_cost_codes" USING btree ("company_id","account_id");--> statement-breakpoint

ALTER TABLE "project_budget_lines" ADD COLUMN "cost_code_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- A cost code appears once on a budget, the same way an account does. Two
-- lines against LAB is two halves of one number.
CREATE UNIQUE INDEX "project_budget_lines_one_per_cost_code" ON "project_budget_lines" USING btree ("budget_id","cost_code_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A cost code charges a postable expense account (decision 1 and 4).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_cost_code_charges_an_expense() RETURNS trigger AS $$
DECLARE
  a record;
BEGIN
  SELECT account_type, can_post, is_active, account_code, account_name
    INTO a
    FROM accounts WHERE id = NEW.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That account is not in this company''s chart.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF a.account_type <> 'expense' THEN
    RAISE EXCEPTION
      'A cost code charges an expense account, and % % is a % account.',
      a.account_code, a.account_name, a.account_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT a.can_post THEN
    RAISE EXCEPTION
      'Nothing can be charged to % % — it is a heading, not a posting account.',
      a.account_code, a.account_name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_cost_code_charges_an_expense"
BEFORE INSERT OR UPDATE OF account_id ON "project_cost_codes"
FOR EACH ROW EXECUTE FUNCTION project_cost_code_charges_an_expense();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The budget line's account comes from its cost code (decision 2).
--
-- Written by the database rather than validated by it, so there is no path
-- that can produce a line whose account disagrees with its code — including
-- the ones nobody has written yet.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_budget_lines_derive_account() RETURNS trigger AS $$
DECLARE
  c record;
BEGIN
  SELECT cc.account_id, cc.code, cc.project_id, a.account_code, a.account_name
    INTO c
    FROM project_cost_codes cc
    JOIN accounts a ON a.id = cc.account_id
   WHERE cc.id = NEW.cost_code_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That cost code does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A project-scoped code belongs to that project's budgets only. A
  -- company-wide code (project_id IS NULL) belongs to all of them.
  IF c.project_id IS NOT NULL
     AND c.project_id <> (SELECT b.project_id FROM project_budgets b WHERE b.id = NEW.budget_id)
  THEN
    RAISE EXCEPTION 'Cost code % belongs to a different project.', c.code
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.account_id             := c.account_id;
  NEW.account_code_at_budget := c.account_code;
  NEW.account_name_at_budget := c.account_name;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_budget_lines_derive_account"
BEFORE INSERT OR UPDATE OF cost_code_id ON "project_budget_lines"
FOR EACH ROW EXECUTE FUNCTION project_budget_lines_derive_account();
