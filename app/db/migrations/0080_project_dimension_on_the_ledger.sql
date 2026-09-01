-- ─────────────────────────────────────────────────────────────────────────────
-- 0080 — The project as a dimension on the ledger.
--
-- `docs/PROJECTS-QALITRACK-PLAN.md` §10.4, item 1: the architectural gap
-- everything else about project cost is downstream of.
--
-- WHAT IT REPLACES. `computeProjectActuals` reconstructs a project's position by
-- scanning five document tables — invoices, credit notes, bills, claims,
-- expenses, stock requests — each with its own status rules. In SAP the WBS
-- element is an account-assignment object: it is ON the posting, so project cost
-- is a ledger query that reconciles to the trial balance by construction.
--
-- What the scan cannot do, and no amount of care will make it do:
--
--   - a MANUAL JOURNAL cannot be charged to a project at all. There is no
--     document to scan.
--   - a project P&L can never be reconciled to the general ledger, because the
--     two are computed from different places.
--   - every new document type that carries a project needs another arm in that
--     query, and forgetting one is silent.
--
-- ── Four decisions ──────────────────────────────────────────────────────────
--
-- 1. ON THE LINE, NOT THE ENTRY.
--    One entry can span projects — a payment settling two invoices on different
--    jobs is the obvious case — so the dimension belongs where the amount is.
--    This is also what SAP, Odoo's analytic lines and NetSuite's segments all
--    do, for the same reason.
--
-- 2. THE COST CODE COMES WITH IT.
--    `bills`, `expenses` and `employee_claims` already carry `cost_code_id`, and
--    it is the dimension a budget is actually checked against —
--    `getProjectBudgetVsActual` compares by cost code. Adding the project
--    without it would mean the ledger could answer "what did this job cost" and
--    not "against which budget line", which is half an answer.
--
-- 3. NULLABLE, AND NOTHING BACKFILLS.
--    Entries posted before this migration have no project on them and will not
--    acquire one: the information is on the source DOCUMENT, and inferring it
--    would write a number nobody observed into the ledger. `computeProjectActuals`
--    stays exactly as it is and keeps answering from the documents — the two run
--    side by side, which is also how anybody finds out whether the scan was ever
--    right.
--
-- 4. NO FOREIGN KEY TO `projects` FROM A POSTED LINE? NO — THERE IS ONE.
--    Considered and rejected: a journal line is immutable history, and a
--    dangling project id would be worse than a constraint. `ON DELETE SET NULL`
--    keeps the ledger valid if a project is ever deleted, and `deleteProject`
--    already refuses while anything points at it.
--
-- WHAT THIS DOES NOT FIX, stated because §10.4 overstated it:
--
--   - **PAYROLL STILL CANNOT REACH A PROJECT.** The column removes the
--     STRUCTURAL barrier and not the DATA one: nothing in this system records
--     which project a person worked on. That is timesheets, and the roster's
--     `rate_amount`/`rate_unit` is the rate waiting for that quantity.
--   - **DEPRECIATION STILL CANNOT EITHER.** `assets` has no `project_id`.
--   - **STOCK ISSUED TO A PROJECT POSTS NOTHING AT ALL.** `recordMovement`,
--     `issueStock` and `createCheckout` insert rows and none of them creates a
--     journal entry, while a bill for an inventory purchase DEBITS Inventory.
--     So materials bought for a job and issued to it are relieved from stock in
--     QUANTITY and never in the LEDGER. On a construction project that is
--     usually the largest cost line, and it is why a ledger-derived project P&L
--     would be missing materials however well this column is populated. It is an
--     accounting decision — see the plan §12 — and not one to make in a
--     migration.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "journal_lines" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "cost_code_id" uuid;--> statement-breakpoint

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- A cost code names a project's budget line, so a line coded to one without
-- naming the project is a code nothing can roll up. Written as a conditional on
-- the cost code, the same pair rule as every other `*_pair` CHECK here.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_code_needs_project" CHECK (
	"cost_code_id" IS NULL OR "project_id" IS NOT NULL
);--> statement-breakpoint

-- The project P&L: every posted line on one project, by account. Partial,
-- because the overwhelming majority of lines carry no project and an index over
-- them all would be mostly dead weight on the busiest table in the schema.
CREATE INDEX "journal_lines_project_idx" ON "journal_lines" USING btree ("company_id","project_id","account_id") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "journal_lines_cost_code_idx" ON "journal_lines" USING btree ("company_id","cost_code_id") WHERE "cost_code_id" IS NOT NULL;
