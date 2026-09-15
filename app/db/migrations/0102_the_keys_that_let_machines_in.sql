-- ─────────────────────────────────────────────────────────────────────────────
-- 0102 — The keys that let machines in.
--
-- The integration CONTROL PLANE. The data plane has been on Postgres for a
-- long time: `weighbridge_tickets` since 0022, the coffee intake since 0090,
-- and `withApiKeyTenant` (app/db/apiTenant.ts) since 0033–0036, which puts a
-- machine caller inside the same transaction, the same `app.company_id` and
-- the same policies as a person.
--
-- What stayed in Mongo was the part that decides whether a machine gets in at
-- all — the keys, the subscriptions, and the log of every exchange. So the
-- shape of an /api/v1 request today is:
--
--   apiKeyAuth()        -> dbConnect(), IntegrationKey.findOne()   [MONGO]
--     resolveCompanyUuid()                                         [POSTGRES]
--       withTenant() -> the repository that does the work          [POSTGRES]
--
-- Two stores on the hot path of the endpoint whose entire justification is
-- that a truck at a gate does not wait, and a Mongo outage that takes out
-- authentication for an API whose data lives somewhere else entirely.
--
-- After this there is nothing left importing app/mongodb.
--
-- ── Decision 1 — THE KEY LOOKUP GETS ITS OWN SCOPE, NOT A BYPASS ──────────
--
-- This is the one thing here that is not like every other table.
--
-- A machine request arrives carrying a bearer token and NOTHING ELSE. No
-- session, no company. So the query that establishes the tenant cannot itself
-- be scoped to one — under `tenant_isolation` it matches `company_id = NULL`,
-- returns zero rows, and every connector on the estate is refused.
--
-- Rejected: a SECURITY DEFINER lookup function. It works, but it puts a
-- privileged, RLS-bypassing function on the request path of every API call,
-- and the safety of the whole arrangement then rests on nobody ever widening
-- what that function returns.
--
-- Taken: a SECOND POLICY under a second scope, which is what this codebase
-- already does for the equivalent question about a PERSON. `withUserScope`
-- sets `app.user_id` with no company, and `user_company_access` has a policy
-- that answers "which companies may I enter" — asked, necessarily, before one
-- is chosen (0033). This is that, for a connector: `withApiKeyScope` sets
-- `app.api_key_hash`, and the policy below matches one row on it.
--
-- The properties that matter:
--   * A caller can see exactly ONE key — the one whose plaintext they already
--     hold. Holding it is what the request is claiming anyway.
--   * `integration_keys` has NO unscoped read path. With neither setting, both
--     policies compare against NULL and the table returns nothing.
--   * `set_config(..., true)` is transaction-local, so the scope cannot ride a
--     pooled connection into the next request. Same as the other two.
--
-- Once the key resolves, apiTenant.ts reopens under `withTenant` and the work
-- happens under the ordinary company scope. An endpoint is not a second,
-- weaker way into the same rows.
--
-- ── Decision 2 — THE HASH IS UNIQUE GLOBALLY, NOT PER COMPANY ─────────────
--
-- Every other unique index here is `(company_id, ...)`. This one cannot be:
-- the hash is what a request presents INSTEAD of naming a tenant, so if two
-- companies could hold the same hash the lookup would have two answers and
-- would authenticate the wrong one about half the time. Mongo has this index
-- too — it is the one integration index it got right.
--
-- ── Decision 3 — THE RETRY WORKER IS SCOPED TO WHAT IT RETRIES ────────────
--
-- The webhook retry worker is genuinely cross-tenant: it runs on a cron, with
-- no session and no company, and claims due deliveries across the estate.
--
-- `withoutTenantScope` is the wrong tool twice over — it is blocked in
-- production by design, and it would hand a REQUEST PATH a connection that can
-- read every tenant's books in order to redeliver a webhook.
--
-- So `sync_logs` carries a third policy, under `app.worker`, scoped to what the
-- worker exists to touch: OUTBOUND deliveries. Not inbound logs, not any
-- tenant's business data, and it needs no role that bypasses RLS.
--
-- ── WHY THE POLICY DOES NOT ALSO PIN THE STATUS ───────────────────────────
--
-- The obvious version of this policy adds `AND status IN ('retrying',
-- 'processing')`, so that even a buggy worker could only ever see deliveries
-- in flight. That version was written first, and it is WRONG — provably, and
-- in a way worth recording, because it looks stricter and is therefore the
-- version somebody will try to restore.
--
-- POSTGRES APPLIES SELECT POLICIES TO THE POST-UPDATE ROW. For a role that
-- does not bypass RLS, an UPDATE on a table with SELECT policies must leave
-- the row still visible under them (ExecWithCheckOptions). So a SELECT policy
-- that only admits 'retrying' and 'processing' does not merely restrict what
-- the worker reads — it forbids it from ever writing 'processed', 'failed' or
-- 'skipped'. Every retry would then succeed on the wire and be retried again
-- for ever, and the sync log would never show a delivery completing.
--
-- It does not show up in casual testing, either: a superuser connection has
-- `rolbypassrls`, so the same UPDATE passes as the owner and fails as
-- `app_user`. `tests/pg-integrations.test.mjs` covers it against the app role
-- for that reason.
--
-- The status filter therefore lives in the worker's claim query, which is
-- where it can do its job without also being a write barrier. What the
-- POLICY guarantees is the part that matters for isolation: outbound only,
-- and only under the worker scope.
--
-- ── Decision 4 — IDEMPOTENCY BECOMES A CONSTRAINT ─────────────────────────
--
-- BaseConnector's idempotency is a read-then-write: look for a processed
-- `sync_log` with this `external_ref`, and if there is none, do the work.
-- Mongo indexes `external_ref` WITHOUT uniqueness, so two concurrent retries
-- from a gate — which is exactly what a gate does when the first call times
-- out — both miss the check and both create a ticket.
--
-- The partial unique index below makes the second one a constraint violation,
-- which apiTenant.ts already turns into a 409. Scoped to inbound rows, because
-- an outbound row's `external_ref` is `webhook:<sub>:<requestId>` and is shared
-- across an emit; and to rows that got somewhere, because a FAILED attempt must
-- be retryable under the same reference — that is what resending means.
--
-- ── Decision 5 — SCOPES ARE AN ENUM ARRAY ─────────────────────────────────
--
-- Mongo types `scopes` as `[String]` with an `enum`. Mongoose applies that
-- enum to the ARRAY, not to its members, so every value validates — and a
-- typo'd scope is not a rejected write, it is a scope that silently grants
-- nothing and fails at the point of use, in production, on a connector
-- somebody else operates.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "connector_type" AS ENUM (
  'weighbridge', 'coffee_coop', 'logistics', 'miller', 'generic'
);--> statement-breakpoint
CREATE TYPE "integration_environment" AS ENUM ('live', 'test');--> statement-breakpoint
CREATE TYPE "integration_scope" AS ENUM (
  'inventory:read', 'inventory:write',
  'contacts:read', 'contacts:write',
  'orders:read', 'orders:write',
  'invoices:read', 'invoices:write',
  'hr:read', 'collection:write', 'webhooks:manage'
);--> statement-breakpoint
CREATE TYPE "sync_direction" AS ENUM ('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "sync_status" AS ENUM (
  'received', 'processing', 'processed', 'failed', 'skipped', 'retrying'
);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- INTEGRATION KEYS — what a machine presents at the door.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "integration_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL
    REFERENCES "companies"("id") ON DELETE CASCADE,

  "name" text NOT NULL,

  /* SHA-256 of the plaintext. The plaintext is shown once, at creation, and
     is not recoverable — not by an admin, not by us. */
  "key_hash" text NOT NULL,
  "key_preview" text NOT NULL,
  "key_prefix" text NOT NULL,

  "connector_type" "connector_type" NOT NULL,

  /* Decision 5. NOT NULL with an empty default: in Mongo "no scopes" and
     "field absent" are different states that the scope check cannot tell
     apart. One state here. */
  "scopes" "integration_scope"[] NOT NULL DEFAULT '{}'::"integration_scope"[],

  "rate_limit_per_minute" integer NOT NULL DEFAULT 60,
  "rate_limit_per_day" integer NOT NULL DEFAULT 5000,

  "environment" "integration_environment" NOT NULL DEFAULT 'live',

  "is_active" boolean NOT NULL DEFAULT true,
  "expires_at" timestamp with time zone,

  "last_used_at" timestamp with time zone,
  "last_used_ip" text,
  "total_requests" integer NOT NULL DEFAULT 0,

  /* The person the key acts on behalf of — what apiTenant.ts records as the
     actor on every row a machine writes. text, like the other actor columns,
     until the backfill lands the user foreign keys (0036). */
  "created_by_id" text,
  "created_by_name" text,

  "notes" text NOT NULL DEFAULT '',

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "integration_keys_preview_length" CHECK (
    char_length("key_preview") = 4
  ),
  CONSTRAINT "integration_keys_rate_limits_positive" CHECK (
    "rate_limit_per_minute" > 0 AND "rate_limit_per_day" > 0
  ),

  /* A key either records who created it or records neither half. Written as a
     conditional on the id, so the only shape ruled out is a name with no id —
     an actor nobody can be held to. */
  CONSTRAINT "integration_keys_created_by_pair" CHECK (
    ("created_by_id" IS NULL AND "created_by_name" IS NULL)
    OR ("created_by_id" IS NOT NULL AND "created_by_name" IS NOT NULL)
  )
);--> statement-breakpoint

/* Decision 2 — global, not per-tenant. */
CREATE UNIQUE INDEX "integration_keys_key_hash_uq"
  ON "integration_keys" ("key_hash");--> statement-breakpoint

CREATE UNIQUE INDEX "integration_keys_id_company_uq"
  ON "integration_keys" ("id", "company_id");--> statement-breakpoint

CREATE INDEX "integration_keys_company_active_idx"
  ON "integration_keys" ("company_id", "is_active", "created_at" DESC);--> statement-breakpoint

CREATE INDEX "integration_keys_company_connector_idx"
  ON "integration_keys" ("company_id", "connector_type");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- WEBHOOK SUBSCRIPTIONS — where the ERP pushes to.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "webhook_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL
    REFERENCES "companies"("id") ON DELETE CASCADE,

  "name" text NOT NULL,
  "url" text NOT NULL,

  /* text[], not an enum — unlike scopes, and for the opposite reason. These
     are PATTERNS: '*' and namespace wildcards like 'invoice.*'. A closed set
     is the wrong shape for them. */
  "events" text[] NOT NULL DEFAULT ARRAY['*']::text[],

  /* Stored in plaintext, unlike an API key, because we SIGN with it rather
     than compare against it — a hash would be useless. It never leaves the
     server. */
  "secret" text NOT NULL,

  "failure_count" integer NOT NULL DEFAULT 0,
  "last_failure_at" timestamp with time zone,
  "suspended" boolean NOT NULL DEFAULT false,

  "is_active" boolean NOT NULL DEFAULT true,

  /* NULL means "any connector". In Mongo this enum has a literal null appended
     to its member list, which Mongoose reads as "null is a valid VALUE" rather
     than "the field is optional" — the distinction lives in the column's
     nullability here, where it belongs. */
  "connector_type" "connector_type",

  "created_by_id" text,
  "created_by_name" text,

  "notes" text NOT NULL DEFAULT '',

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "webhook_subscriptions_failure_count_non_negative" CHECK (
    "failure_count" >= 0
  ),
  CONSTRAINT "webhook_subscriptions_events_not_empty" CHECK (
    array_length("events", 1) >= 1
  ),

  /* HTTPS, or localhost for development. Mongo enforces this in the server
     action only, so a subscription written by any other path — a script, a
     future endpoint — could ship signed payloads over plaintext. */
  CONSTRAINT "webhook_subscriptions_url_scheme" CHECK (
    "url" LIKE 'https://%' OR "url" LIKE 'http://localhost%'
  ),

  CONSTRAINT "webhook_subscriptions_created_by_pair" CHECK (
    ("created_by_id" IS NULL AND "created_by_name" IS NULL)
    OR ("created_by_id" IS NOT NULL AND "created_by_name" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "webhook_subscriptions_id_company_uq"
  ON "webhook_subscriptions" ("id", "company_id");--> statement-breakpoint

/* The emitter's query, as an index over exactly the rows it can deliver to —
   so a company with a long tail of revoked subscriptions does not pay for
   them on every emit. */
CREATE INDEX "webhook_subscriptions_deliverable_idx"
  ON "webhook_subscriptions" ("company_id", "created_at" DESC)
  WHERE "is_active" AND NOT "suspended";--> statement-breakpoint

CREATE INDEX "webhook_subscriptions_company_active_idx"
  ON "webhook_subscriptions" ("company_id", "is_active", "created_at" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- SYNC LOGS — every exchange, both directions.
--
-- Not only an audit trail: idempotency reads it (Decision 4) and the retry
-- worker claims from it (Decision 3).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "sync_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL
    REFERENCES "companies"("id") ON DELETE CASCADE,

  /* SET NULL, not CASCADE. Revoking a key must not erase the record of what
     it did while it was valid. */
  "integration_key_id" uuid
    REFERENCES "integration_keys"("id") ON DELETE SET NULL,
  "webhook_subscription_id" uuid
    REFERENCES "webhook_subscriptions"("id") ON DELETE SET NULL,

  "direction" "sync_direction" NOT NULL,
  "event" text NOT NULL,
  "connector_type" "connector_type",

  "external_ref" text,
  "internal_ref" text,
  "internal_id" uuid,

  "raw_payload" jsonb,
  "mapped_payload" jsonb,
  "result" jsonb,

  "status" "sync_status" NOT NULL DEFAULT 'received',
  "error" text,

  "attempts" integer NOT NULL DEFAULT 0,
  "next_retry_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,

  "http_status" integer,
  "response_body" text,
  "webhook_url" text,

  "request_ip" text,
  /* Stable across retries, so the body — and therefore the signature — is
     identical on every attempt and a subscriber can deduplicate. */
  "request_id" text,

  "processed_at" timestamp with time zone,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "sync_logs_attempts_non_negative" CHECK ("attempts" >= 0),

  /* A row waiting for a retry must say when. Without this, 'retrying' with a
     null next_retry_at is a delivery no worker will ever claim and no page
     will ever show as failed. It just stops. */
  CONSTRAINT "sync_logs_retrying_has_next_retry" CHECK (
    "status" <> 'retrying' OR "next_retry_at" IS NOT NULL
  )
);--> statement-breakpoint

/* Decision 4 — idempotency as a constraint rather than a convention. */
CREATE UNIQUE INDEX "sync_logs_inbound_external_ref_uq"
  ON "sync_logs" ("company_id", "external_ref")
  WHERE "direction" = 'inbound'
    AND "external_ref" IS NOT NULL
    AND "status" IN ('processed', 'processing');--> statement-breakpoint

CREATE INDEX "sync_logs_company_status_idx"
  ON "sync_logs" ("company_id", "status", "created_at" DESC);--> statement-breakpoint

CREATE INDEX "sync_logs_company_direction_idx"
  ON "sync_logs" ("company_id", "direction", "created_at" DESC);--> statement-breakpoint

CREATE INDEX "sync_logs_company_external_ref_idx"
  ON "sync_logs" ("company_id", "external_ref");--> statement-breakpoint

CREATE INDEX "sync_logs_company_internal_ref_idx"
  ON "sync_logs" ("company_id", "internal_ref");--> statement-breakpoint

CREATE INDEX "sync_logs_company_key_idx"
  ON "sync_logs" ("company_id", "integration_key_id", "created_at" DESC);--> statement-breakpoint

/* The worker's claim query. Partial, because the due set is a vanishing
   fraction of an append-only table that grows with every API request served. */
CREATE INDEX "sync_logs_due_retry_idx"
  ON "sync_logs" ("next_retry_at")
  WHERE "status" = 'retrying' AND "next_retry_at" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "integration_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "integration_keys"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

/*
 * Decision 1 — the pre-tenant lookup.
 *
 * Policies are PERMISSIVE, so this ORs with tenant_isolation above rather than
 * narrowing it. With neither setting present both sides compare against NULL,
 * the whole expression is NULL, and the table returns nothing: it fails closed
 * exactly like every other table here.
 *
 * SELECT only. Reading the row is the entire job — everything after it happens
 * under the company scope.
 */
CREATE POLICY api_key_lookup ON "integration_keys"
  FOR SELECT
  USING (key_hash = NULLIF(current_setting('app.api_key_hash', true), ''));--> statement-breakpoint

/*
 * The usage counters — last_used_at, last_used_ip, total_requests — are
 * stamped on the way in, before a tenant has been resolved, so they need the
 * same scope.
 *
 * This grants nothing new: the caller is holding the key's plaintext, which is
 * already full API access to that tenant. The WITH CHECK repeats the USING so
 * a row cannot be rewritten to carry someone else's hash.
 */
CREATE POLICY api_key_usage ON "integration_keys"
  FOR UPDATE
  USING (key_hash = NULLIF(current_setting('app.api_key_hash', true), ''))
  WITH CHECK (key_hash = NULLIF(current_setting('app.api_key_hash', true), ''));--> statement-breakpoint

ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "webhook_subscriptions"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "sync_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "sync_logs"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

/*
 * Decision 3 — the retry worker.
 *
 * `current_setting('app.worker', true)` is NULL when unset, and NULL = 'x' is
 * NULL, so an ordinary request matches nothing here and the worker scope has
 * to be asked for explicitly.
 *
 * DO NOT ADD `AND status IN ('retrying', 'processing')` TO THIS POLICY. It
 * reads like a free tightening and it is not: Postgres applies SELECT policies
 * to the row an UPDATE leaves behind, so pinning the status here forbids the
 * worker from ever recording a delivery as processed. See the long note at the
 * top of this file; the status filter belongs in the claim query, and is
 * there.
 */
CREATE POLICY retry_worker ON "sync_logs"
  FOR SELECT
  USING (
    current_setting('app.worker', true) = 'webhook-retry'
    AND direction = 'outbound'
  );--> statement-breakpoint

CREATE POLICY retry_worker_update ON "sync_logs"
  FOR UPDATE
  USING (
    current_setting('app.worker', true) = 'webhook-retry'
    AND direction = 'outbound'
  )
  WITH CHECK (
    current_setting('app.worker', true) = 'webhook-retry'
    AND direction = 'outbound'
  );--> statement-breakpoint

/*
 * The worker also has to read the subscription it is delivering to — its url,
 * its secret, and whether it has since been suspended. Same scope, same
 * narrowness: only subscriptions that are still active.
 */
CREATE POLICY retry_worker ON "webhook_subscriptions"
  FOR SELECT
  USING (
    current_setting('app.worker', true) = 'webhook-retry'
    AND is_active
  );--> statement-breakpoint

/*
 * And it has to trip or reset the circuit breaker after an attempt. It may
 * only ever write those four columns' worth of state onto a row it could
 * already see; the repository is what restricts the column list.
 */
CREATE POLICY retry_worker_update ON "webhook_subscriptions"
  FOR UPDATE
  USING (
    current_setting('app.worker', true) = 'webhook-retry'
    AND is_active
  )
  WITH CHECK (
    current_setting('app.worker', true) = 'webhook-retry'
  );
