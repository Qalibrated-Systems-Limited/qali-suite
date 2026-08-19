-- ============================================================================
-- 0034 — A user can see the companies they hold a grant for.
--
-- Found immediately by the tests, which is the point of writing them alongside.
--
-- listAllowedCompanies joins user_company_access to companies to get names for
-- the switcher, and runs under withUserScope — app.user_id set, app.company_id
-- deliberately not. The grants policy (0033) answers, but `companies` keys on
-- app.company_id and returned ZERO rows, so the join produced nothing and
-- every user looked as though they had no grants at all.
--
-- The fix is not to loosen the company policy but to add a second one for a
-- second legitimate question. A company is visible when:
--
--   • it IS the active tenant                    (0024 — operating on it)
--   • the user holds an active grant for it      (this — may switch into it)
--
-- Postgres ORs multiple permissive policies, so each keeps its own boundary
-- and neither widens the other. This grants sight of a NAME to choose from,
-- not of any tenant's data: every business table still keys on
-- app.company_id, so a company in the switcher whose tenant is not active
-- shows nothing behind it.
-- ============================================================================

CREATE POLICY "visible_to_grantees" ON "companies"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_company_access a
       WHERE a.company_id = companies.id
         AND a.status = 'active'
         AND a.user_id = NULLIF(current_setting('app.user_id', true), '')
    )
  );
