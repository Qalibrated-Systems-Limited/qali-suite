-- ============================================================================
-- 0044 — Invitations.
--
-- The last thing auth still reached into Mongo for. A pending invite decides
-- what role a person gets on their first sign-in, so leaving it behind would
-- have meant an "auth on Postgres" that still could not answer the one question
-- it is asked at the moment a new user arrives.
--
-- COMPANY-SCOPED AND UNDER RLS, unlike `users`. A login is a platform-wide
-- identity — one person, one row, whichever companies they hold. An invitation
-- is an act by one company: "we are asking this person to join US". So it is
-- keyed on company_id and the tenant policy applies, and two companies may
-- invite the same address independently.
--
-- THE TOKEN IS ALREADY A HASH. The source emails a raw token and stores its
-- hash, which is the right way round and is carried unchanged. The unique index
-- is on the hash and is PLATFORM-WIDE rather than per company: a token is a
-- credential, and two rows sharing one would make "which invite is this" a
-- question with two answers.
-- ============================================================================

CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'Employee',

  -- The employee this invite will become the login for, when it is an employee
  -- portal invite. Composite, so an invite cannot name another tenant's party.
  "party_id" uuid,

  "token" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  -- Which login accepted it. Text like the other actor columns (0031).
  "accepted_by_id" text,

  "invited_by_id" text NOT NULL,
  "invited_by_name" text NOT NULL,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "invites_party_fk"
    FOREIGN KEY ("party_id", "company_id")
    REFERENCES "parties"("id", "company_id") ON DELETE SET NULL,

  CONSTRAINT "invites_status_valid"
    CHECK ("status" IN ('pending', 'accepted', 'cancelled', 'expired')),

  -- The role list of 0039. An invite that promises a role the users table would
  -- refuse is an invitation that cannot be honoured.
  CONSTRAINT "invites_role_valid" CHECK ("role" IN (
    'SuperAdmin', 'Admin', 'CFO', 'Finance Manager', 'Accountant',
    'Sales Manager', 'Procurement Officer', 'Manager', 'Store Manager',
    'Storekeeper', 'HR Manager', 'Employee', 'Viewer'
  )),

  -- An accepted invite records when, and nothing else does.
  CONSTRAINT "invites_accepted_has_time" CHECK (
    ("status" = 'accepted' AND "accepted_at" IS NOT NULL)
    OR ("status" <> 'accepted' AND "accepted_at" IS NULL)
  )
);--> statement-breakpoint

-- A token is a credential: platform-wide unique, not per tenant.
CREATE UNIQUE INDEX "invites_token_uq" ON "invites" ("token");--> statement-breakpoint

-- The lookup on accept: by token, among the ones still open.
CREATE INDEX "invites_token_pending_idx" ON "invites" ("token")
  WHERE "status" = 'pending';--> statement-breakpoint

-- The company's own list, and the "have we already asked this person" check.
CREATE INDEX "invites_company_status_idx" ON "invites" ("company_id", "status");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" (lower("email"), "company_id");--> statement-breakpoint

-- ONE OPEN INVITE PER PERSON PER COMPANY. The source checked this in the
-- action and raced with itself: two admins inviting the same address at once
-- both found nothing and both inserted. A partial unique index cannot.
CREATE UNIQUE INDEX "invites_one_open_per_email_uq"
  ON "invites" ("company_id", lower("email"))
  WHERE "status" = 'pending';--> statement-breakpoint

ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "invites"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "invites" TO app_user;
