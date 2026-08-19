-- ============================================================================
-- 0037 — A tenant can see who else is in it.
--
-- Found immediately by the test for 0036's `visible_within_company` policy,
-- which is the point of writing them together.
--
-- That policy answers "which logins may I see" by asking whether we share an
-- active grant:
--
--     EXISTS (SELECT 1 FROM user_company_access a WHERE a.user_id = users.id
--               AND a.company_id = current_setting('app.company_id'))
--
-- But `user_company_access` is ITSELF under row-level security, and its only
-- policy (0033) is `user_id = app.user_id` — your own grants. So inside that
-- subquery a user could see their own grant and nobody else's, the EXISTS was
-- false for every colleague, and a company of forty people looked like a
-- company of one.
--
-- RLS NESTS. A policy that reads a protected table is filtered by that table's
-- policies too, which is correct and easy to forget.
--
-- The fix is not SECURITY DEFINER on a helper function — that would be a hole
-- in the one table that says who may enter which company, to answer a question
-- that has a perfectly good bounded form. It is a second permissive policy for
-- a second legitimate question, the same move 0034 made for `companies`:
--
--   • my own grants, wherever I am        (0033 — which companies may I enter)
--   • every grant in the ACTIVE company   (this — who else is in here with me)
--
-- Postgres ORs permissive policies, so each keeps its own boundary. This one
-- is bounded by app.company_id, so it reveals colleagues and never another
-- tenant's members — and it exposes nothing that `visible_within_company` was
-- not already meant to.
--
-- SELECT only. Who may enter a company is still administered from outside the
-- tenant's own scope (companyAccessAdmin), because granting yourself a role is
-- not something a tenant user should be able to do by writing a row.
-- ============================================================================

CREATE POLICY "visible_within_company" ON "user_company_access"
  FOR SELECT
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
  );
