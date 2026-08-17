-- ============================================================================
-- 0009 — Journal lines snapshot the account code and name AS POSTED.
--
-- Reverses a decision made in 0000. That migration dropped the cached
-- accountCode/accountName from journal lines on the grounds that a cache goes
-- stale and a join is always current. That reasoning was wrong here, and
-- inconsistent with the same file storing unit_price on invoice lines.
--
-- A posted journal entry is an audit record. Renaming "Office Expenses" to
-- "Admin Expenses" must not silently relabel a trial balance printed two years
-- ago — prior-period reports have to stay reproducible.
--
-- The distinction that was collapsed:
--
--   mutable cache      written at any time, can drift, needs syncing
--   immutable snapshot written once at posting, CANNOT drift, that is the point
--
-- Mongo had an unenforced snapshot: nothing ever updated lines.accountName
-- after creation, so it was already frozen — but it was frozen by accident, and
-- read inconsistently. reportsService.js joins and shows the CURRENT name,
-- while erp-dashboard-queries.ts reads $first: "$lines.accountName", the name
-- AS POSTED. Rename an account and those two screens disagree, with nothing
-- indicating which is authoritative.
--
-- Here the snapshot is explicit and the database refuses to rewrite it.
--
-- WHICH TO USE:
--   account_id             -> all aggregation, balances, trial balance, any
--                             report grouping by the live chart of accounts
--   *_at_posting           -> reproducing a journal document as it was posted,
--                             and any prior-period artefact that must not move
-- ============================================================================

ALTER TABLE "journal_lines"
  ADD COLUMN "account_code_at_posting" text,
  ADD COLUMN "account_name_at_posting" text;
--> statement-breakpoint

-- Backfill existing rows from the current chart. For rows written before this
-- migration the current name is the best available evidence of the posted one —
-- nothing has renamed an account in between, because this database has only
-- ever been loaded by the backfill.
UPDATE journal_lines l
   SET account_code_at_posting = a.account_code,
       account_name_at_posting = a.account_name
  FROM accounts a
 WHERE a.id = l.account_id
   AND l.account_code_at_posting IS NULL;
--> statement-breakpoint

ALTER TABLE "journal_lines"
  ALTER COLUMN "account_code_at_posting" SET NOT NULL,
  ALTER COLUMN "account_name_at_posting" SET NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Populate on insert when the caller does not supply them, so the snapshot
-- cannot be forgotten. A caller replaying a historical document may pass the
-- values explicitly; those are respected.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_snapshot_account_on_line() RETURNS trigger AS $$
BEGIN
  IF COALESCE(NEW.account_code_at_posting, '') = ''
     OR COALESCE(NEW.account_name_at_posting, '') = '' THEN
    SELECT a.account_code, a.account_name
      INTO NEW.account_code_at_posting, NEW.account_name_at_posting
      FROM accounts a WHERE a.id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER journal_lines_snapshot_account
  BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_snapshot_account_on_line();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Immutability. "Snapshot" is a claim until the database enforces it; without
-- this, the columns are just a cache nobody happens to update yet — which is
-- exactly the state Mongo was in.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_account_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.account_code_at_posting IS DISTINCT FROM OLD.account_code_at_posting
     OR NEW.account_name_at_posting IS DISTINCT FROM OLD.account_name_at_posting
  THEN
    RAISE EXCEPTION
      'account_code_at_posting / account_name_at_posting are immutable: they record what journal line % said when it was posted',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER journal_lines_snapshot_is_immutable
  BEFORE UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_account_snapshot_immutable();
--> statement-breakpoint

-- The empty-string DEFAULT exists purely so callers may omit these columns:
-- NOT NULL without a default would force every insert to supply them, defeating
-- the point of the trigger that fills them. The default is never observable —
-- Postgres applies column defaults BEFORE row-level BEFORE INSERT triggers, so
-- trg_snapshot_account_on_line() has already replaced it by the time the row is
-- stored. The NOT NULL constraint still holds.
ALTER TABLE "journal_lines"
  ALTER COLUMN "account_code_at_posting" SET DEFAULT '',
  ALTER COLUMN "account_name_at_posting" SET DEFAULT '';
