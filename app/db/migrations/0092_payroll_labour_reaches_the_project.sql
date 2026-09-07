-- ─────────────────────────────────────────────────────────────────────────────
-- 0090 — A payroll run can re-allocate, so labour can reach a project late.
--
-- 0089 built the timesheet. This is the other half: payroll now splits its
-- expense lines by project, and a run needs a third kind of journal for the
-- timesheet that is approved AFTER the accrual has posted.
--
-- ── Why the split is a DIMENSION and not a new account ──────────────────────
--
-- `journal_lines.project_id` has existed since 0084 and payroll never set it.
-- Every accrual line was built from `payroll_runs` TOTALS — one aggregate
-- amount per account — so a contractor's own labour, usually the largest cost
-- on a job, sat in the P&L and reached no project at all.
--
-- The fix needs no chart change and no second expense account. Jane's 100,000
-- is debited to the same salary expense account it always was; three lines
-- carry a project and one carries the residual:
--
--   DR Salary expense  60,000   project = Otho Road
--   DR Salary expense  30,000   project = Bridge
--   DR Salary expense  10,000   (no project — office time, leave)
--      CR Salaries payable ... etc, unchanged
--
-- Total expense is exactly what it was. A second account, or an entry
-- crediting cash, would have made 160,000 of expense out of a 100,000 salary —
-- which is the failure this design exists to avoid.
--
-- THE STATUTORY LINES CARRY NO PROJECT, deliberately. PAYE, NSSF, SHIF and AHL
-- are owed to the state, not to a job; tagging them would file a statutory
-- liability inside a contract's cost.
--
-- ── What this migration actually changes ────────────────────────────────────
--
-- Only the CHECK. `payroll_run_journals.kind` was `accrual | payment |
-- reversal`, and re-allocation is a fourth: an entry that belongs to the run,
-- is not the accrual, and must not be mistaken for one when a void goes
-- looking for what to reverse.
--
-- A re-allocation entry debits and credits THE SAME ACCOUNT — the project
-- changes, the account does not — so it nets to zero on every account it
-- touches and the trial balance by account is untouched. It exists to move a
-- dimension, and naming its kind is what keeps that visible.
--
-- NOTE FOR THE NEXT READER: the Drizzle schema declared this column as plain
-- `text()` with no check, so the constraint was invisible from
-- `app/db/schema/hrPayroll.ts` and only the DDL had it. The check is now
-- declared in both. If you are adding a `kind`, change both files.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "payroll_run_journals"
  DROP CONSTRAINT "payroll_run_journals_kind_valid";--> statement-breakpoint

ALTER TABLE "payroll_run_journals"
  ADD CONSTRAINT "payroll_run_journals_kind_valid"
  CHECK ("kind" IN ('accrual', 'payment', 'reversal', 'reallocation'));
