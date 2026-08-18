-- ============================================================================
-- 0030 — `future` is a fiscal period status, and the posting guard says so.
--
-- Found provisioning a tenant. Onboarding creates twelve monthly periods and
-- opens only the first; the other eleven are `future`
-- (companyOnboardingService.js:143). fiscal_period_status carried only open,
-- closed and locked, so eleven of every twelve periods could not be written.
--
-- This is not only a provisioning problem. The BACKFILL passes the source
-- status straight through (`p.status ?? 'open'`), so it would have failed on
-- the first real tenant it touched — every onboarded company has eleven
-- `future` periods. It never showed up because the backfill fixture seeds a
-- single period, and that period is open. The §9B.2 enum audit read twelve
-- surfaces and did not read this one.
--
-- ---------------------------------------------------------------------------
-- WHY `future` STAYS POSTABLE.
--
-- The guard in 0001 is a DENY-list — it refuses `closed` and `locked` and
-- admits everything else — so adding a value to the enum silently makes it
-- permissive. That is the wrong default for a control, and it is worth saying
-- out loud rather than leaving as an accident of how the IF was written.
--
-- But the answer here is still to admit it, because NOTHING ADVANCES A PERIOD
-- OUT OF `future`. There is no scheduled job, no open-on-arrival, no
-- open-the-next-one-when-you-close-this-one; the only writer of `open` is
-- period creation and an explicit reopen. A company onboarded in January has
-- February through December sitting at `future` forever, so refusing them
-- would stop the ledger working in month two.
--
-- So the deny-list is kept and made explicit. The gap it papers over — that a
-- period never opens by itself — is real, and closing it is a product decision
-- (open on period start? on first posting? a nightly job?) rather than
-- something a schema migration should pick. Recorded rather than fixed.
-- ============================================================================

ALTER TYPE "public"."fiscal_period_status" ADD VALUE IF NOT EXISTS 'future' BEFORE 'open';--> statement-breakpoint

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

  -- Deliberately a deny-list, and deliberately admitting 'future': see the
  -- header. A period that has been closed or locked is a statement that its
  -- books are done; a period that is merely `future` has only never been
  -- opened by anything, because nothing opens one.
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
