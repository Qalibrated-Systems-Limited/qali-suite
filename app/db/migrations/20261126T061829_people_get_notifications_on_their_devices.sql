-- ============================================================================
-- PEOPLE GET NOTIFICATIONS ON THEIR DEVICES
--
-- A person may turn on push notifications in a browser or on a phone; each
-- device they turn it on for is a subscription here. When a notification is
-- written for them (the bell), it is also pushed to their devices.
--
-- Per USER, not per company: one device, one person, whatever company the
-- notification comes from. Read and written only by the server's privileged
-- connection, filtered by user — the application role gets no access.
--
-- SAFE TO APPLY because: a new, empty table.
-- ============================================================================

CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_sent_at" timestamp with time zone,
  "failures" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("endpoint" LIKE 'https://%')
);--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
