-- ============================================================================
-- 0001 — Invariants the application can no longer violate.
--
-- Everything here exists because the Mongo implementation enforced it in
-- application code, where it could be bypassed. See docs/POSTGRES-MIGRATION-PLAN.md.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS ltree;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Account hierarchy as ltree
--    Replaces the denormalised `ancestors[]` array + `path` string, which had
--    to be rewritten on every account move.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "accounts" ALTER COLUMN "path" TYPE ltree USING NULLIF("path", '')::ltree;
--> statement-breakpoint
CREATE INDEX "accounts_path_gist_idx" ON "accounts" USING GIST ("path");
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Composite FKs so a journal line can never reference another tenant's
--    entry or account.
--
--    A plain FK on entry_id alone would allow company A's line to point at
--    company B's entry. Requiring (id, company_id) to match makes the tenant
--    boundary part of referential integrity rather than a runtime check.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_id_company_uq" UNIQUE ("id", "company_id");
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_company_uq" UNIQUE ("id", "company_id");
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT IF EXISTS "journal_lines_entry_id_journal_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT IF EXISTS "journal_lines_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_tenant_fk"
  FOREIGN KEY ("entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_tenant_fk"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Double-entry balance, enforced at COMMIT.
--
--    Mongo used `Math.abs(debits - credits) < 0.01` — a float-drift tolerance
--    that let an entry post up to a cent out of balance. numeric(19,4) is
--    exact, so this uses strict equality.
--
--    DEFERRABLE INITIALLY DEFERRED lets a caller insert the entry and its
--    lines one statement at a time; the check runs once at COMMIT.
--
--    Scope: only `posted` and `reversed` entries must balance. Drafts are
--    working documents and may be incomplete — matching the existing UX, where
--    validateBeforePosting() ran at post() time, not at save() time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_entry_balanced(p_entry_id uuid) RETURNS void AS $$
DECLARE
  v_status      text;
  v_debit       numeric(19,4);
  v_credit      numeric(19,4);
  v_line_count  integer;
  v_number      text;
BEGIN
  SELECT e.status::text, e.entry_number INTO v_status, v_number
  FROM journal_entries e WHERE e.id = p_entry_id;

  -- Entry was deleted in this transaction; nothing to enforce.
  IF NOT FOUND THEN RETURN; END IF;

  IF v_status NOT IN ('posted', 'reversed') THEN RETURN; END IF;

  SELECT COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0), COUNT(*)
    INTO v_debit, v_credit, v_line_count
  FROM journal_lines l WHERE l.entry_id = p_entry_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION
      'Journal entry % must have at least 2 lines (has %)', v_number, v_line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION
      'Journal entry % is not balanced: debits % <> credits %', v_number, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_lines_balanced() RETURNS trigger AS $$
BEGIN
  PERFORM assert_entry_balanced(COALESCE(NEW.entry_id, OLD.entry_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_entry_balanced() RETURNS trigger AS $$
BEGIN
  PERFORM assert_entry_balanced(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Fires when lines change...
CREATE CONSTRAINT TRIGGER journal_lines_must_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_lines_balanced();
--> statement-breakpoint

-- ...and when an entry transitions into posted/reversed without its lines
-- changing (the draft -> posted path).
CREATE CONSTRAINT TRIGGER journal_entries_must_balance
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_entry_balanced();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fiscal period guard.
--
--    In Mongo this lived in JournalEntry.validateFiscalPeriod() and was
--    bypassable: entries constructed directly via the model never set
--    fiscalPeriodId, so a reversal could post INTO a closed period. Here the
--    period is resolved from entry_date on the way in and cannot be skipped.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_resolve_fiscal_period() RETURNS trigger AS $$
DECLARE
  v_period  fiscal_periods%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('posted', 'reversed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period
  FROM fiscal_periods p
  WHERE p.company_id = NEW.company_id
    AND NEW.entry_date BETWEEN p.start_date AND p.end_date
  LIMIT 1;

  -- Tenants that don't run fiscal periods are unaffected, matching the prior
  -- behaviour where a missing period meant "nothing to enforce".
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_period.status IN ('closed', 'locked') THEN
    RAISE EXCEPTION
      'Cannot post entry % into % fiscal period %',
      NEW.entry_number, v_period.status, v_period.period_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Backfill so period reports keyed on fiscal_period_id stay accurate.
  NEW.fiscal_period_id := v_period.id;
  NEW.fiscal_year      := v_period.year;
  NEW.fiscal_month     := v_period.month;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER journal_entries_fiscal_period_guard
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_resolve_fiscal_period();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. System accounts cannot be deleted.
--    Replaces the Mongoose pre("remove") hook, which only fired on
--    document.remove() and was silently skipped by deleteOne/findOneAndDelete.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_protect_system_account() RETURNS trigger AS $$
BEGIN
  IF OLD.system_account IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot delete system account "%" (%). It is required for system operation.',
      OLD.account_name, OLD.system_account
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER accounts_protect_system
  BEFORE DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION trg_protect_system_account();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Race-free per-company entry numbering.
--    Replaces `find({entryNumber: /^JE-REV-/}).sort().limit(1)` + increment,
--    which raced under concurrency and relied on a unique-index violation to
--    catch the collision.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "entry_counters" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "prefix"     text NOT NULL,
  "last_value" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("company_id", "prefix")
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION next_entry_number(p_company_id uuid, p_prefix text)
RETURNS text AS $$
DECLARE
  v_next bigint;
BEGIN
  INSERT INTO entry_counters (company_id, prefix, last_value)
       VALUES (p_company_id, p_prefix, 1)
  ON CONFLICT (company_id, prefix)
  DO UPDATE SET last_value = entry_counters.last_value + 1
    RETURNING last_value INTO v_next;

  RETURN p_prefix || '-' || LPAD(v_next::text, 5, '0');
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Row-Level Security.
--
--    This is the structural fix for the 3,479 hand-written companyId filters.
--    A query that forgets its tenant scope now returns ZERO rows instead of
--    another tenant's books — see getStatementOfAccount() and
--    calculateActualBalance() in the Mongo models, both of which scan
--    cross-tenant today.
--
--    FORCE is required: without it the table OWNER bypasses RLS entirely, and
--    the app role is typically the owner.
--
--    Policies read `current_setting('app.company_id', true)`. The `true`
--    returns NULL when unset rather than raising, and `company_id = NULL` is
--    NULL — so unscoped access fails closed. app/db/client.ts sets this
--    transaction-locally via withTenant().
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'fiscal_periods', 'journal_entries', 'journal_lines', 'entry_counters']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;
