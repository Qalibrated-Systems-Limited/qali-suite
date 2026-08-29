-- ─────────────────────────────────────────────────────────────────────────────
-- 0074 — The notification bell moves to Postgres.
--
-- Reported from the running app: every dashboard render logged
--
--   No legacy Mongo id for company 4d6ab761-…. Mongo collections are keyed by
--   the ObjectId they were written with, and _migration_id_map has no
--   'companies' row for this uuid.
--
-- `notification-queries.js` scoped the bell by translating the active company's
-- uuid BACK to an ObjectId. A company created after the migration has no
-- ObjectId, so the translation throws. `cMyNotifications` swallows its own
-- errors and returns an empty bell, so this was a log line rather than a crash
-- — which is how it went unnoticed.
--
-- The same query would have failed one step later for older tenants anyway:
-- it matches `userId` with `ObjectId.isValid`, and users have been Postgres
-- since 0036.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "notification_type" AS ENUM ('approval_request', 'approval_decision', 'system');--> statement-breakpoint

CREATE TABLE "notifications" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id"    text NOT NULL,
  "type"       "notification_type" NOT NULL,
  "title"      text NOT NULL,
  "body"       text,
  "href"       text,
  "read_at"    timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "notifications_title_length"
    CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT "notifications_body_length"
    CHECK ("body" IS NULL OR length("body") <= 500),
  -- An app-relative path or nothing. Not in the Mongo schema: `href` becomes a
  -- link the recipient clicks, so refusing an absolute URL here stops a future
  -- writer turning the bell into an open redirect.
  CONSTRAINT "notifications_href_is_relative"
    CHECK ("href" IS NULL OR "href" ~ '^/[^/]')
);--> statement-breakpoint

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade;--> statement-breakpoint

-- A notification addressed to a deleted login is unreachable, not history.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;--> statement-breakpoint

-- The bell's latest-N.
CREATE INDEX "notifications_company_user_idx"
  ON "notifications" ("company_id", "user_id", "created_at" DESC);--> statement-breakpoint

-- The unread count, which runs on EVERY dashboard render. Partial, so the
-- read archive is never scanned to answer "how many unread".
CREATE INDEX "notifications_unread_idx"
  ON "notifications" ("company_id", "user_id")
  WHERE "read_at" IS NULL;--> statement-breakpoint

-- Mongo expired these with a TTL index after 90 days. Postgres has no TTL, so
-- the sweep is /api/cron/prune-notifications and this is what keeps it cheap.
-- Dropping the self-cleaning property silently was the alternative.
CREATE INDEX "notifications_created_idx"
  ON "notifications" ("created_at");--> statement-breakpoint

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO app_user;
