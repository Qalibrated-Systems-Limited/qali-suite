-- Run this first. It shows every login and which company/role they operate
-- as — that's the company_id the seed project needs, so the project shows up
-- for the user you're actually logged in as (RLS scopes everything to the
-- ACTIVE company on the session, not just any company that happens to exist).
SELECT
  u.id            AS user_id,
  u.name,
  u.email,
  u.role          AS global_role,
  uca.company_id,
  c.name          AS company_name,
  uca.granted_via
FROM users u
JOIN user_company_access uca ON uca.user_id = u.id
JOIN companies c ON c.id = uca.company_id
ORDER BY u.email;
