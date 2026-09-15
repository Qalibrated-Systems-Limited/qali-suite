import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import {
  connectorTypeEnum,
  integrationEnvironmentEnum,
  integrationScopeEnum,
  syncDirectionEnum,
  syncStatusEnum,
} from "./enums";

/**
 * The integration control plane — 0102.
 *
 * The data plane went to Postgres first and has been there for some time:
 * `weighbridge_tickets` (0022), the coffee intake (0090), and `withApiKeyTenant`
 * in app/db/apiTenant.ts, which puts a machine caller inside the same
 * transaction, the same `app.company_id` and the same policies as a person.
 *
 * What stayed behind was the part that decides WHETHER a machine gets in at
 * all: the keys, the subscriptions they can register, and the log of every
 * exchange. So every /api/v1 request has been opening a Mongo connection to
 * authenticate and then a Postgres transaction to do the work — two stores on
 * the hot path of an endpoint whose whole point is that a truck at a gate does
 * not wait. This closes that.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Integration keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An API key issued to an external system.
 *
 * THE KEY IS NEVER STORED. `key_hash` is the SHA-256 of the plaintext, which is
 * shown to the admin once at creation and is not recoverable afterwards;
 * `key_prefix` and `key_preview` exist so the UI can name a key without holding
 * one.
 *
 * READ BEFORE THE TENANT IS KNOWN, which is the one thing about this table that
 * is not like every other table here. A request arrives carrying a bearer token
 * and nothing else — no session, no company — so the lookup that establishes
 * the tenant cannot itself be scoped to one. Under the standard policy that
 * SELECT matches `company_id = NULL`, returns zero rows, and every machine
 * caller is refused.
 *
 * The answer is the same one `user_company_access` uses for "which companies
 * may I enter", asked before a company is chosen: a SECOND policy under a
 * different scope. 0102 adds `app.api_key_hash`, and `withApiKeyScope` in
 * client.ts sets it. A caller can therefore see exactly one row — the key whose
 * plaintext they already hold — and the table has no unscoped read path. It
 * fails closed like everything else.
 */
export const integrationKeys = pgTable(
  "integration_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    /** SHA-256 of the plaintext. Globally unique — see the index below. */
    keyHash: text("key_hash").notNull(),
    /** Last 4 characters of the plaintext, for display only. */
    keyPreview: text("key_preview").notNull(),
    /** e.g. "qls_live_k" — the half of the key that is not a secret. */
    keyPrefix: text("key_prefix").notNull(),

    connectorType: connectorTypeEnum("connector_type").notNull(),

    /**
     * NOT NULL with an empty default: Mongo's `default: []` and its
     * `required: false` combine to make "no scopes" and "field absent"
     * different states that the scope check treats identically. One state here.
     */
    scopes: integrationScopeEnum("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::integration_scope[]`),

    /** Per-key overrides. The plan default applies when these are null. */
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    rateLimitPerDay: integer("rate_limit_per_day").notNull().default(5000),

    environment: integrationEnvironmentEnum("environment")
      .notNull()
      .default("live"),

    isActive: boolean("is_active").notNull().default(true),
    /** Null never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // ── Usage ────────────────────────────────────────────────────────────────
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: text("last_used_ip"),
    totalRequests: integer("total_requests").notNull().default(0),

    /**
     * The person the key acts on behalf of, which is what apiTenant.ts records
     * as the actor on every row a machine writes. `text` for the same reason
     * the other 47 actor columns are text — see 0036.
     */
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),

    notes: text("notes").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * GLOBALLY unique, not per-company — and this is load-bearing rather than
     * tidy. The hash is what a request presents INSTEAD of naming a tenant, so
     * if two companies could hold the same hash the lookup would have two
     * answers and would authenticate the wrong one half the time. Mongo has
     * this index; it is the one integration index it got right.
     */
    uniqueIndex("integration_keys_key_hash_uq").on(t.keyHash),
    uniqueIndex("integration_keys_id_company_uq").on(t.id, t.companyId),
    index("integration_keys_company_active_idx").on(
      t.companyId,
      t.isActive,
      t.createdAt.desc(),
    ),
    index("integration_keys_company_connector_idx").on(
      t.companyId,
      t.connectorType,
    ),
    check(
      "integration_keys_preview_length",
      sql`char_length(${t.keyPreview}) = 4`,
    ),
    check(
      "integration_keys_rate_limits_positive",
      sql`${t.rateLimitPerMinute} > 0 AND ${t.rateLimitPerDay} > 0`,
    ),
    /**
     * A pair constraint: a key either records who created it or records
     * neither half. Written as a conditional on the id so "id set, name null"
     * is the only shape it has to rule out — a name without an id is an actor
     * nobody can be held to.
     */
    check(
      "integration_keys_created_by_pair",
      sql`(${t.createdById} IS NULL AND ${t.createdByName} IS NULL)
          OR (${t.createdById} IS NOT NULL AND ${t.createdByName} IS NOT NULL)`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Webhook subscriptions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A subscriber URL that receives signed POSTs when an ERP event fires.
 *
 * `secret` is stored in plaintext, unlike an API key, and the difference is
 * deliberate: we SIGN with it rather than compare against it, so a hash would
 * be useless. It never leaves the server.
 *
 * `suspended` is a circuit breaker, not a state a person chooses — five
 * consecutive delivery failures set it, and the first success clears it.
 */
export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    url: text("url").notNull(),

    /**
     * `text[]`, not an enum, and unlike `integration_keys.scopes` that is the
     * right call: the values include `"*"` and namespace wildcards like
     * `"invoice.*"`, which are patterns rather than members of a closed set.
     */
    events: text("events")
      .array()
      .notNull()
      .default(sql`ARRAY['*']::text[]`),

    /** HMAC-SHA256 signing secret. Shown to the admin once, then display-only. */
    secret: text("secret").notNull(),

    // ── Circuit breaker ──────────────────────────────────────────────────────
    failureCount: integer("failure_count").notNull().default(0),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    suspended: boolean("suspended").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),

    /** Null means "deliver events from any connector". */
    connectorType: connectorTypeEnum("connector_type"),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),

    notes: text("notes").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_subscriptions_id_company_uq").on(t.id, t.companyId),
    /**
     * The emitter's query is (company, active, not suspended) and then a match
     * on `events`. The partial index is over exactly the rows it can deliver
     * to, so a company with a long tail of revoked subscriptions does not pay
     * for them on every emit.
     */
    index("webhook_subscriptions_deliverable_idx")
      .on(t.companyId, t.createdAt.desc())
      .where(sql`${t.isActive} AND NOT ${t.suspended}`),
    index("webhook_subscriptions_company_active_idx").on(
      t.companyId,
      t.isActive,
      t.createdAt.desc(),
    ),
    check(
      "webhook_subscriptions_failure_count_non_negative",
      sql`${t.failureCount} >= 0`,
    ),
    check(
      "webhook_subscriptions_events_not_empty",
      sql`array_length(${t.events}, 1) >= 1`,
    ),
    /**
     * HTTPS, or localhost for development. Mongo checks this in the server
     * action only, so a subscription written by any other path — a script, a
     * future endpoint — could ship signed payloads over plaintext.
     */
    check(
      "webhook_subscriptions_url_scheme",
      sql`${t.url} LIKE 'https://%' OR ${t.url} LIKE 'http://localhost%'`,
    ),
    check(
      "webhook_subscriptions_created_by_pair",
      sql`(${t.createdById} IS NULL AND ${t.createdByName} IS NULL)
          OR (${t.createdById} IS NOT NULL AND ${t.createdByName} IS NOT NULL)`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Sync logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append-only record of every exchange with an external system, in both
 * directions.
 *
 * It is not only an audit trail. Two mechanisms READ it:
 *
 *   1. IDEMPOTENCY. BaseConnector looks for a processed row with the same
 *      `external_ref` before doing any work, so a gate that retries a call
 *      gets the first result back rather than a second ticket. Mongo indexes
 *      `external_ref` without uniqueness, so two concurrent retries both miss
 *      the check and both proceed — the partial unique index below makes the
 *      second one a constraint violation instead.
 *
 *   2. RETRY. An outbound delivery that failed sits here as `retrying` with
 *      `next_retry_at` set, and the cron worker claims it. Nothing is held in
 *      process memory, so a deploy mid-backoff does not drop deliveries.
 */
export const syncLogs = pgTable(
  "sync_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /**
     * Which key brought this in. `set null` rather than `cascade`: revoking a
     * key must not erase the record of what it did.
     */
    integrationKeyId: uuid("integration_key_id").references(
      () => integrationKeys.id,
      { onDelete: "set null" },
    ),
    webhookSubscriptionId: uuid("webhook_subscription_id").references(
      () => webhookSubscriptions.id,
      { onDelete: "set null" },
    ),

    direction: syncDirectionEnum("direction").notNull(),
    /** e.g. "weighbridge.ticket_completed", "invoice.paid". */
    event: text("event").notNull(),
    connectorType: connectorTypeEnum("connector_type"),

    /** The sender's own id for this event — the idempotency key. */
    externalRef: text("external_ref"),
    /** The ERP document that resulted, e.g. "INV-000456". */
    internalRef: text("internal_ref"),
    internalId: uuid("internal_id"),

    rawPayload: jsonb("raw_payload"),
    mappedPayload: jsonb("mapped_payload"),
    result: jsonb("result"),

    status: syncStatusEnum("status").notNull().default("received"),
    error: text("error"),

    // ── Retry state (outbound) ───────────────────────────────────────────────
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),

    httpStatus: integer("http_status"),
    responseBody: text("response_body"),
    webhookUrl: text("webhook_url"),

    // ── Request metadata (inbound) ───────────────────────────────────────────
    requestIp: text("request_ip"),
    /** Stable across retries, so a subscriber can deduplicate deliveries. */
    requestId: text("request_id"),

    processedAt: timestamp("processed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * The idempotency guarantee, as a constraint rather than a convention.
     *
     * Scoped to INBOUND rows: an outbound row's `external_ref` is
     * `webhook:<sub>:<requestId>`, which is shared by every subscription in one
     * emit and is not a key. Scoped to rows that got somewhere — a failed
     * attempt must be allowed to be retried under the same reference, which is
     * the whole point of a gate resending.
     */
    uniqueIndex("sync_logs_inbound_external_ref_uq")
      .on(t.companyId, t.externalRef)
      .where(
        sql`${t.direction} = 'inbound'
            AND ${t.externalRef} IS NOT NULL
            AND ${t.status} IN ('processed', 'processing')`,
      ),
    index("sync_logs_company_status_idx").on(
      t.companyId,
      t.status,
      t.createdAt.desc(),
    ),
    index("sync_logs_company_direction_idx").on(
      t.companyId,
      t.direction,
      t.createdAt.desc(),
    ),
    index("sync_logs_company_external_ref_idx").on(t.companyId, t.externalRef),
    index("sync_logs_company_internal_ref_idx").on(t.companyId, t.internalRef),
    index("sync_logs_company_key_idx").on(
      t.companyId,
      t.integrationKeyId,
      t.createdAt.desc(),
    ),
    /**
     * The retry worker's claim query, and the reason it is partial: it asks for
     * due rows across ALL tenants (it runs on a cron, outside a session), and
     * the rows it wants are a vanishing fraction of an append-only table that
     * grows with every request the API serves.
     *
     * This index, not the worker's RLS policy, is what makes the claim narrow.
     * 0102 records why the policy cannot also pin the status: Postgres checks
     * SELECT policies against the row an UPDATE leaves behind, so a policy
     * that admits only in-flight rows stops the worker completing anything.
     */
    index("sync_logs_due_retry_idx")
      .on(t.nextRetryAt)
      .where(sql`${t.status} = 'retrying' AND ${t.nextRetryAt} IS NOT NULL`),
    check("sync_logs_attempts_non_negative", sql`${t.attempts} >= 0`),
    /**
     * A row that is waiting for a retry must say when. Without this, `retrying`
     * with a null `next_retry_at` is a delivery that no worker will ever claim
     * and no page will ever show as failed — it just stops.
     */
    check(
      "sync_logs_retrying_has_next_retry",
      sql`${t.status} <> 'retrying' OR ${t.nextRetryAt} IS NOT NULL`,
    ),
  ],
);
