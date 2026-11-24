-- ============================================================================
-- STAFF AWAY FROM THE OFFICE NEED A REMOTE-ACCESS TOKEN
--
-- A company can keep QaliSuite to its office network: requests from its
-- office addresses work as before; from anywhere else a person sees a waiting
-- page unless the system administrator has issued them a remote-access token.
--
--   * company_network_policy — whether the rule is on (OFF by default: nothing
--     changes for anyone until an administrator switches it on);
--   * company_office_networks — the office's public addresses or CIDR blocks;
--   * remote_access_tokens — one per person, expiring, revocable. Only a
--     SHA-256 hash is stored; the token is shown once, when issued.
--
-- SAFE TO APPLY because: new tables, empty, and the policy defaults to off.
-- ============================================================================

CREATE TABLE "company_network_policy" (
  "company_id" uuid PRIMARY KEY NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "office_only" boolean DEFAULT false NOT NULL,
  "updated_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_name" text DEFAULT 'System' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "company_office_networks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "network" text NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_office_networks_not_blank" CHECK (length(btrim("network")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "company_office_networks_unique_idx" ON "company_office_networks" ("company_id", "network");--> statement-breakpoint

CREATE TABLE "remote_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_name" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_hint" text NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by_name" text,
  "last_used_at" timestamp with time zone,
  "last_used_ip" text,
  "created_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "remote_access_tokens_expiry_after_issue" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "remote_access_tokens_hash_idx" ON "remote_access_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "remote_access_tokens_company_idx" ON "remote_access_tokens" ("company_id", "user_id");--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_network_policy', 'company_office_networks', 'remote_access_tokens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "company_network_policy" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "company_office_networks" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "remote_access_tokens" TO app_user;
