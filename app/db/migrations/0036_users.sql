-- ============================================================================
-- 0036 — Users, and the link from a login to a person.
--
-- 0031 made 47 actor columns `text` with a name snapshot, because "there is no
-- users table to reference". This is that table.
--
-- ── THE ID IS TEXT, NOT A NEW UUID ──────────────────────────────────────────
--
-- Every actor column already holds the id this platform has always used for a
-- person, and so does user_company_access.user_id (0033). A uuid primary key
-- here would mean rewriting all of them and carrying a second id map for the
-- rest of the system's life. A text key means every one of those columns
-- becomes a foreign key the day its rows exist.
--
-- New users created after Mongo retires get a uuid — as text. An id is an
-- opaque token; what matters is that there is exactly one per person.
--
-- ── PLATFORM-LEVEL, NOT COMPANY-SCOPED ──────────────────────────────────────
--
-- A user may operate in several companies (0033), so a company_id on this
-- table would contradict the grants. What Mongo calls User.companyId is their
-- HOME company, which is `home_company_id` here and is also the grant marked
-- 'primary'.
--
-- ── THE PARTY LINK IS PER COMPANY ───────────────────────────────────────────
--
-- Odoo's model is res.users → res.partner: the login points at the person.
-- That works there because res.partner is global. Here `parties` is
-- company-scoped and under RLS — a person who is an employee of company A and
-- a supplier to company B has two party rows, because AR and AP are per
-- company and must be.
--
-- So `users.party_id` would be wrong: it would force one party for every
-- company a person works in. The link goes on user_company_access instead,
-- which already has exactly one row per (user, company) — the right
-- cardinality for "in THIS company, this login is that person".
--
-- ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
--
-- The password hash. Moving credentials is a deliberate, security-sensitive
-- cutover of its own and NextAuth still reads them through mongoose; a column
-- added now would be one nothing enforces, which reads like a control and is
-- not one. `token_version` IS here, because the session-freshness check
-- enforces it and will need it the moment auth moves.
--
-- ── NO FOREIGN KEYS YET ─────────────────────────────────────────────────────
--
-- user_company_access.user_id and the 47 actor columns reference users that
-- have not been backfilled yet. The FKs land in their own migration once the
-- backfill has run against a real database — adding them here would fail on
-- the first existing row, and adding them NOT VALID would break the next
-- grant written for a user this table has not seen.
-- ============================================================================

CREATE TABLE "users" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'User',
  "status" text NOT NULL DEFAULT 'active',
  "department" text,
  "avatar" text,
  "auth_provider" text NOT NULL DEFAULT 'credentials',

  /** Their own company. Null for platform staff, who belong to none. */
  "home_company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL,

  /**
   * Bumped when a privilege or credential changes, so an issued JWT can be
   * rejected without waiting for it to expire.
   */
  "token_version" integer NOT NULL DEFAULT 0,

  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "users_status_valid" CHECK ("status" IN ('active', 'inactive')),
  CONSTRAINT "users_auth_provider_valid"
    CHECK ("auth_provider" IN ('credentials', 'google')),
  CONSTRAINT "users_email_present" CHECK (length(btrim("email")) > 0)
);--> statement-breakpoint

-- One login per email address, case-insensitively. Mongo's unique index is on
-- the raw string with a lowercase setter, which means it enforces nothing if a
-- write ever bypasses the setter.
CREATE UNIQUE INDEX "users_email_uq" ON "users" (lower("email"));--> statement-breakpoint
CREATE INDEX "users_home_company_idx" ON "users" ("home_company_id");--> statement-breakpoint

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- A user always sees themselves — including before a company is chosen, which
-- is when the switcher asks who they are.
CREATE POLICY "own_row" ON "users"
  USING ("id" = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK ("id" = NULLIF(current_setting('app.user_id', true), ''));
--> statement-breakpoint

-- And the colleagues they share a company with. Keyed through the grants, so
-- "who is in this company" has exactly one answer and it is the same rows the
-- tenant gate reads. Never another tenant's users: an unset app.company_id
-- matches nothing rather than everything.
CREATE POLICY "visible_within_company" ON "users"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_company_access a
       WHERE a.user_id = users.id
         AND a.status = 'active'
         AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "users" TO app_user;--> statement-breakpoint

-- No DELETE. A user who leaves is `status = 'inactive'`: their id is on
-- journal entries, approvals and grants going back years, and deleting the row
-- would leave every one of those pointing at nothing. Same reason a revoked
-- grant is suspended rather than removed (0033).

-- ============================================================================
-- The link: in THIS company, this login is that person.
--
-- Nullable, and it will stay nullable. A SuperAdmin is not a party to any
-- company's books; an Admin may have a login and no employee record. A party
-- is what someone is to the LEDGER — a customer, a supplier, an employee — and
-- plenty of logins are none of those.
--
-- Scoped by construction: parties(id, company_id) is unique (0005), so the
-- composite reference makes it impossible to point a grant for company A at a
-- party belonging to company B. A plain reference to parties(id) would allow
-- exactly that, and RLS would not catch it because provisioning and admin
-- paths run privileged.
-- ============================================================================
ALTER TABLE "user_company_access"
  ADD COLUMN "party_id" uuid;--> statement-breakpoint

ALTER TABLE "user_company_access"
  ADD CONSTRAINT "user_company_access_party_fk"
  FOREIGN KEY ("party_id", "company_id")
  REFERENCES "parties"("id", "company_id") ON DELETE SET NULL;--> statement-breakpoint

-- One login per party per company. Two grants pointing at the same person
-- would make "who is this employee's login" ambiguous, which is the question
-- the column exists to answer.
CREATE UNIQUE INDEX "user_company_access_party_uq"
  ON "user_company_access" ("company_id", "party_id")
  WHERE "party_id" IS NOT NULL;
