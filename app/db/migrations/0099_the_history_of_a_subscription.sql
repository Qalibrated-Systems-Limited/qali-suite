-- ─────────────────────────────────────────────────────────────────────────────
-- 0099 — The history of a subscription.
--
-- `lib/subscription-helpers.js` has carried this note since 0035:
--
--   "The subscription state lives in Postgres since 0035. The audit LOG is
--    still a Mongo collection, so this writes across both: the state where the
--    company record is, the history where its history already is. Moving
--    SubscriptionAuditLog is its own migration."
--
-- This is that migration. It is the last thing keeping a SuperAdmin screen on
-- Mongo, and it is a record of who changed what a company pays — which is
-- exactly the kind of history that should not sit in a store the rest of the
-- billing state left.
--
-- ── Decision 1 — IT IS A PLATFORM TABLE, READ ON THE PRIVILEGED CONNECTION ─
--
-- Nothing inside a tenant reads it: the only consumer is
-- /dashboard/admin/companies/[id]/subscription, which is SuperAdmin-only and
-- built on `app/db/platform.ts` — the one cross-tenant surface, on
-- `privilegedDb`, because `companies` is itself under RLS keyed on its own id
-- (0024) and a scoped connection sees exactly one.
--
-- RLS is enabled here anyway, keyed on company_id. The privileged connection
-- bypasses it, so it costs nothing; and on the day something reads this from
-- an application connection it fails CLOSED rather than handing one tenant
-- another tenant's billing history.
--
-- ── Decision 2 — THE BEFORE AND AFTER ARE COLUMNS, NOT JSON ───────────────
--
-- Mongo embedded `previous` and `updated` as two sub-documents of six fields.
-- Flattened to twelve columns rather than two `jsonb` blobs, because the
-- screen reads six of them by name and a query like "every company downgraded
-- off enterprise last quarter" is a WHERE clause on a column and a
-- json-extract-and-cast on a blob. The set is closed and has not changed since
-- the model was written.
--
-- ── Decision 3 — ONE ROW PER CHANGE, WHICH MONGO ALREADY DID ──────────────
--
-- `updateSubscription` decides which of plan / status / maxUsers / trial
-- actually moved and writes one row per change, so a single form submission
-- that changes a plan AND extends a trial produces two rows. Kept: it is what
-- makes "when did the plan change" answerable without parsing a combined row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "subscription_audit_action" AS ENUM (
  'plan_changed',
  'status_changed',
  'trial_started',
  'trial_extended',
  'max_users_changed',
  'renewed',
  'cancelled',
  'auto_expired'
);--> statement-breakpoint

CREATE TABLE "subscription_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "action" "subscription_audit_action" NOT NULL,

  -- The state that was replaced. Every field nullable: a company on its first
  -- ever change has no meaningful "before" for most of them.
  "previous_plan" text,
  "previous_status" text,
  "previous_max_users" integer,
  "previous_trial_ends_at" timestamp with time zone,
  "previous_period_start" timestamp with time zone,
  "previous_period_end" timestamp with time zone,

  -- The state that replaced it.
  "updated_plan" text,
  "updated_status" text,
  "updated_max_users" integer,
  "updated_trial_ends_at" timestamp with time zone,
  "updated_period_start" timestamp with time zone,
  "updated_period_end" timestamp with time zone,

  /* Who, and why. `changed_by_name` is a snapshot — this is a record of what
     somebody did, and it has to stay readable after they leave. */
  "changed_by_id" text,
  "changed_by_name" text NOT NULL DEFAULT 'System',
  "reason" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  /* A seat count is a count. The Mongo schema typed it `Number` and would
     have accepted -3. */
  CONSTRAINT "subscription_audit_max_users_sane" CHECK (
    ("previous_max_users" IS NULL OR "previous_max_users" >= -1)
    AND ("updated_max_users" IS NULL OR "updated_max_users" >= -1)
  )
);--> statement-breakpoint

/* The only query the screen makes: this company, newest first. */
CREATE INDEX "subscription_audit_company_idx"
  ON "subscription_audit_log" ("company_id", "created_at" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 1 — enabled, and bypassed by the privileged connection that reads
-- it. It costs nothing today and fails closed tomorrow.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "subscription_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "subscription_audit_log"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

/* SELECT ONLY for the application role, and the REVOKE is the part that does
   the work. 0023 set `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT,
   UPDATE, DELETE ON TABLES TO app_user`, so every table created since arrives
   fully writable and the explicit GRANT lines in later migrations are no-ops
   restating what already happened. Granting SELECT here would therefore have
   changed nothing and read as if it had.

   A tenant has no business writing its own billing history — RLS would confine
   a forged row to their own company, which is not a reason to let them write
   one. The platform layer that does write it runs on the privileged
   connection, not as app_user. */
REVOKE INSERT, UPDATE, DELETE ON "subscription_audit_log" FROM app_user;--> statement-breakpoint
GRANT SELECT ON "subscription_audit_log" TO app_user;
