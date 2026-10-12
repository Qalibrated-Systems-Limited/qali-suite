-- ============================================================================
-- FIFTEEN VIEWS WERE SERVING EVERY TENANT'S ROWS TO EVERY TENANT — 0118
--
-- A Postgres view runs with the privileges of its OWNER unless it is created
-- `WITH (security_invoker = true)`. Every view here is owned by `postgres`, a
-- superuser, and a superuser bypasses row-level security. So a policy that
-- correctly restricts `accounts` to one company stops restricting anything the
-- moment the same rows are read through a view over that table.
--
-- Demonstrated, not deduced. Two companies, one connection as `app_user` with
-- `app.company_id` set to the first:
--
--     SELECT account_name FROM accounts          -> Alpha Ltd Inventory
--     SELECT account_name FROM account_balances  -> Alpha Ltd Inventory
--                                                   Bravo Ltd Inventory
--
-- The base table obeyed its policy. The view over it did not.
--
-- WHY IT WAS NOT CAUGHT. 0024 added `rls_coverage_gaps` precisely so "a table
-- added later cannot quietly miss RLS" — and it filters `c.relkind = 'r'`.
-- It audits tables. A view is `relkind = 'v'` and was never in scope, which is
-- the one shape that does not need a policy of its own in order to leak: it
-- needs the policies of the tables beneath it to be evaluated as the caller,
-- and by default they are not.
--
-- Eight migrations got this right and say why in their comments — 0002, 0006,
-- 0008, 0012, 0014, 0016, 0019, 0022. The rest did not, and `account_balances`
-- had the option in 0002 and LOST it in 0004, which replaced the view with
-- CREATE OR REPLACE and did not carry the option forward. That is the trap in
-- this specific mistake: it is invisible at the call site, it survives review
-- because the view definition itself looks right, and it can be reintroduced
-- by a migration that only meant to change a WHERE clause.
--
-- WHAT THIS DOES NOT CHANGE: which rows a correctly scoped query returns. Every
-- caller of these views already runs inside `withTenant`, which sets
-- `app.company_id` — the policies simply start applying to them. A view that
-- returned one tenant's rows returns exactly the same rows afterwards.
-- ============================================================================

-- ALTER rather than CREATE OR REPLACE: the definitions are correct and
-- untouched, and rewriting fifteen view bodies to change one storage parameter
-- would be fifteen chances to change something else by accident.
ALTER VIEW "account_balances"             SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "asset_state"                  SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "bank_statement_stats"         SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "employee_claim_state"         SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "employees_on_leave"           SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "goods_receipt_state"          SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "gr_ir_open_items"             SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "leave_balances"               SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "loan_balances"                SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "nonconformance_state"         SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "outstanding_checkouts"        SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "purchase_order_line_billed"   SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "purchase_order_line_received" SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "purchase_order_state"         SET (security_invoker = true);--> statement-breakpoint
ALTER VIEW "quote_line_invoiced"          SET (security_invoker = true);--> statement-breakpoint

-- `rls_coverage_gaps` is deliberately NOT in that list. It reads pg_class and
-- pg_policy — catalogue metadata about the schema, not any tenant's rows — and
-- it is the audit itself. It carries no company_id and has nothing to leak.

-- ─────────────────────────────────────────────────────────────────────────────
-- The audit, widened to the shape that caused this.
--
-- One row per object carrying tenant data that is not protected: a TABLE
-- without forced RLS and a policy, or a VIEW that does not evaluate those
-- policies as the caller. Empty is the passing state, and a test asserts it —
-- which is what 0024 said should happen and what would have caught this.
-- ─────────────────────────────────────────────────────────────────────────────
-- DROPPED and recreated, not CREATE OR REPLACE: that form may only append
-- columns at the end, and `object_kind` belongs beside the name it qualifies.
-- Nothing in the application selects this view — it is an audit read by a test
-- and by hand — so there is no dependency to break.
DROP VIEW IF EXISTS "rls_coverage_gaps";--> statement-breakpoint

CREATE VIEW "rls_coverage_gaps" AS
SELECT c.relname                                     AS table_name,
       CASE c.relkind WHEN 'r' THEN 'table' ELSE 'view' END AS object_kind,
       c.relrowsecurity                              AS rls_enabled,
       c.relforcerowsecurity                         AS rls_forced,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy,
       -- Meaningless for a table, and the whole question for a view.
       COALESCE(
         (c.reloptions IS NOT NULL
          AND 'security_invoker=true' = ANY (c.reloptions)),
         false
       )                                             AS security_invoker
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'v')
   -- Objects that carry tenant data: a company_id column, or companies itself.
   AND (c.relname = 'companies'
        OR EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attname = 'company_id'
                      AND NOT a.attisdropped))
   AND CASE c.relkind
         -- A table is protected by forced RLS plus at least one policy.
         WHEN 'r' THEN NOT (c.relrowsecurity
                            AND c.relforcerowsecurity
                            AND EXISTS (SELECT 1 FROM pg_policy p
                                         WHERE p.polrelid = c.oid))
         -- A view is protected by deferring to the caller's policies. It needs
         -- no policy of its own, and having one would not help.
         ELSE NOT COALESCE(
           (c.reloptions IS NOT NULL
            AND 'security_invoker=true' = ANY (c.reloptions)),
           false
         )
       END;--> statement-breakpoint

GRANT SELECT ON "rls_coverage_gaps" TO app_user;--> statement-breakpoint
