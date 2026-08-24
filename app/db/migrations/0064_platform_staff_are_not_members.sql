-- ============================================================================
-- 0064 — Platform staff are not members, and a role belongs to a membership.
--
-- Two corrections to the access model, both of which the existing rows already
-- carry enough information to make.
--
-- ── 1. A STANDING PLATFORM GRANT IS NOT A COLLEAGUE ─────────────────────────
--
-- `visible_within_company` (0036) shows you everyone holding an active grant on
-- the company you are scoped to. It does not look at WHY the grant exists, so a
-- SuperAdmin's standing access — topped up automatically by grantAllTenants for
-- every tenant in the deployment — reads as ordinary membership, and platform
-- staff appear in each customer's user list.
--
-- Every ERP and SaaS that separates the two keeps support staff out of the
-- tenant's member list: Stripe, Xero, Slack, Atlassian. The member list answers
-- "who works here", and a platform operator does not.
--
-- THE ROW ALREADY KNOWS. `granted_via` is 'superadmin' for standing access and
-- 'invite' / 'primary' / 'manual' for a real membership, so this needs no new
-- column and no backfill — only a policy that reads the column that is there.
--
-- WHAT IS DELIBERATELY NOT CHANGED: the policy on `user_company_access` itself
-- (0037). The company's ACCESS LIST must go on showing platform grants — that
-- is the audit record, and tenant.ts:231 chose a dated, named, revocable row
-- over a scattered role check precisely so it can answer "who could read these
-- books in March". Two surfaces, two questions:
--
--     /dashboard/users        "who works here"           platform staff hidden
--     company access list     "who can open these books" platform staff shown
--
-- A SuperAdmin still sees THEMSELVES inside a tenant, via the `own_row` policy,
-- so nothing they need to operate disappears.
--
-- ── 2. THE ROLE BELONGS TO THE MEMBERSHIP ───────────────────────────────────
--
-- `withAuthorizedTenant` has always re-checked the role for the ACTIVE company
-- and documented the fallback: "Null on the grant means the global role, which
-- is what every grant carried over from the single-company model says."
--
-- The fallback is all there is, because nothing ever writes the column.
-- `createUserFromInvite` inserts the grant without it, so a user invited as an
-- Accountant to one company is an Accountant EVERYWHERE — including companies
-- they are granted later, by someone who never chose that.
--
-- A global identity with a per-membership role is the standard arrangement
-- (Xero, QuickBooks, AWS Organizations, Google Workspace). This backfills what
-- the fallback was standing in for, so the column becomes the answer rather
-- than a null that means "look somewhere else".
--
-- Platform grants stay NULL on purpose: their authority is the global
-- SuperAdmin role, which is exactly what the fallback should resolve to. Pinning
-- 'SuperAdmin' onto each tenant row would make revoking the role leave standing
-- per-company copies behind.
-- ============================================================================

DROP POLICY IF EXISTS "visible_within_company" ON "users";--> statement-breakpoint
CREATE POLICY "visible_within_company" ON "users"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_company_access a
       WHERE a.user_id = users.id
         AND a.status = 'active'
         -- Standing platform access is not membership.
         AND a.granted_via IS DISTINCT FROM 'superadmin'
         AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );--> statement-breakpoint

-- The role each existing membership was actually given, promoted out of the
-- global column it was being read from.
UPDATE user_company_access a
   SET role = u.role, updated_at = now()
  FROM users u
 WHERE u.id = a.user_id
   AND a.role IS NULL
   AND a.granted_via IS DISTINCT FROM 'superadmin';--> statement-breakpoint

-- An index for the policy's EXISTS: it now filters on three columns, and the
-- 0033 index covers (user_id, company_id) only.
CREATE INDEX IF NOT EXISTS "user_company_access_membership_idx"
  ON "user_company_access" ("company_id", "user_id")
  WHERE "status" = 'active' AND "granted_via" IS DISTINCT FROM 'superadmin';
