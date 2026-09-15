-- ─────────────────────────────────────────────────────────────────────────────
-- 0092 — A certificate keeps the terms it was signed under.
--
-- ── What was wrong, and it was not small ───────────────────────────────────
--
-- `listCertificates` recomputes EVERY certificate — certified ones included —
-- from the contract as it stands TODAY. Nothing about the arithmetic was
-- frozen. `project_certificates_frozen` freezes the four figures somebody
-- TYPED; it says nothing about the retention percentage they are multiplied
-- by, because that lives on the contract.
--
-- And `saveProjectContract` has no guard against editing terms once
-- certificates exist. So:
--
--   1. IPC 1 certifies 5,000,000 of work with retention at 0%. Net 5,000,000,
--      and an invoice is raised in the ledger for 5,000,000.
--   2. Somebody sets retention to 10% — a correction of an omission, and an
--      entirely reasonable thing to do.
--   3. IPC 1 NOW READS: retention held 500,000, net 4,500,000.
--
-- A document that was issued, signed and paid against has silently changed its
-- figures, and the invoice behind it has not. Every downstream number moves
-- with it: the chain's `previouslyCertified`, "% of contract certified",
-- retention outstanding, the advance position.
--
-- It is the same class of bug as a re-priced bill of quantities restating a
-- final account, and 0076 froze that for the same reason.
--
-- ── The fix is the one this schema already uses everywhere ─────────────────
--
-- SNAPSHOT THE COMMERCIAL TERMS ONTO THE CERTIFICATE WHEN IT IS CERTIFIED.
-- `account_code_at_budget` (0073), `supplier_name_at_bill`, the rate snapshot
-- on `project_timesheets` (0089) — the idiom is established, and it is the
-- right one: the figure a document was computed with belongs to the document.
--
-- A DRAFT KEEPS FOLLOWING THE LIVE CONTRACT, deliberately. That is what a
-- draft is for: enter the terms, see what the certificate would be, correct
-- the terms, look again. Only certifying fixes them.
--
-- ── The cap is nullable INSIDE the snapshot ────────────────────────────────
--
-- `retention_cap_percent` is legitimately NULL — it means uncapped, and 0081
-- treats it that way. So the "is there a snapshot" question cannot be asked of
-- it. The biconditional is written against `retention_percent_at_certificate`,
-- which is NOT NULL wherever a snapshot exists, and the other three are tied
-- to the same condition. A pair CHECK needs both columns or neither, and the
-- cap is neither — it is a value that may be absent on its own.
--
-- ── Backfilling is honest, and it is the only option ───────────────────────
--
-- Existing certified certificates get TODAY'S terms stamped on them. Nothing
-- else is knowable: the contract carries no history of what its retention
-- percentage used to be, which is precisely the hole being closed. What this
-- buys is that they cannot drift from here, and it changes no figure on the
-- day it runs — today's terms are exactly what they are being computed with
-- right now.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "project_certificates"
  ADD COLUMN "contract_sum_at_certificate" numeric(19, 4),
  ADD COLUMN "retention_percent_at_certificate" numeric(5, 2),
  ADD COLUMN "retention_cap_percent_at_certificate" numeric(5, 2),
  ADD COLUMN "advance_amount_at_certificate" numeric(19, 4),
  ADD COLUMN "advance_recovery_percent_at_certificate" numeric(5, 2);--> statement-breakpoint

-- Every certificate that has been issued — `certified_at` survives a
-- cancellation, and a cancelled certificate's figures are still displayed, so
-- it needs its terms as much as a standing one does.
--
-- This UPDATE passes `project_certificates_frozen`: none of the columns that
-- trigger guards is touched.
UPDATE "project_certificates" c
   SET "contract_sum_at_certificate"             = ct."contract_sum",
       "retention_percent_at_certificate"        = ct."retention_percent",
       "retention_cap_percent_at_certificate"    = ct."retention_cap_percent",
       "advance_amount_at_certificate"           = ct."advance_amount",
       "advance_recovery_percent_at_certificate" = ct."advance_recovery_percent"
  FROM "project_contracts" ct
 WHERE ct."id" = c."contract_id"
   AND c."certified_at" IS NOT NULL;--> statement-breakpoint

-- Issued means snapshot, and the reverse. A draft carrying one would be a
-- draft that had stopped following the contract it is being drafted against.
ALTER TABLE "project_certificates"
  ADD CONSTRAINT "project_certificates_snapshot_pair"
  CHECK (("certified_at" IS NULL) = ("retention_percent_at_certificate" IS NULL));--> statement-breakpoint

-- The other three travel with it. The CAP is deliberately absent from this
-- list: NULL there means uncapped, not missing.
ALTER TABLE "project_certificates"
  ADD CONSTRAINT "project_certificates_snapshot_complete"
  CHECK (
    "certified_at" IS NULL
    OR ("contract_sum_at_certificate" IS NOT NULL
        AND "advance_amount_at_certificate" IS NOT NULL
        AND "advance_recovery_percent_at_certificate" IS NOT NULL)
  );--> statement-breakpoint

ALTER TABLE "project_certificates"
  ADD CONSTRAINT "project_certificates_snapshot_non_negative"
  CHECK (
    ("contract_sum_at_certificate" IS NULL OR "contract_sum_at_certificate" >= 0)
    AND ("retention_percent_at_certificate" IS NULL OR "retention_percent_at_certificate" >= 0)
    AND ("retention_cap_percent_at_certificate" IS NULL OR "retention_cap_percent_at_certificate" >= 0)
    AND ("advance_amount_at_certificate" IS NULL OR "advance_amount_at_certificate" >= 0)
    AND ("advance_recovery_percent_at_certificate" IS NULL OR "advance_recovery_percent_at_certificate" >= 0)
  );--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- And the snapshot is frozen with everything else it was signed beside.
--
-- Without this the columns exist and are editable on an issued certificate,
-- which reopens the same hole one level down: the terms could no longer drift
-- from the contract, and could still be edited directly.
--
-- Verbatim from 0081 apart from the five new lines, because the arm that lets
-- a draft through and the message it raises are both still right.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_certificates_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.work_done_to_date          IS NOT DISTINCT FROM OLD.work_done_to_date
     AND NEW.materials_on_site      IS NOT DISTINCT FROM OLD.materials_on_site
     AND NEW.dayworks_to_date       IS NOT DISTINCT FROM OLD.dayworks_to_date
     AND NEW.retention_released_to_date
                                    IS NOT DISTINCT FROM OLD.retention_released_to_date
     AND NEW.valuation_date         IS NOT DISTINCT FROM OLD.valuation_date
     AND NEW.period_from            IS NOT DISTINCT FROM OLD.period_from
     AND NEW.period_to              IS NOT DISTINCT FROM OLD.period_to
     AND NEW.sequence               IS NOT DISTINCT FROM OLD.sequence
     AND NEW.contract_id            IS NOT DISTINCT FROM OLD.contract_id
     AND NEW.contract_sum_at_certificate
                                    IS NOT DISTINCT FROM OLD.contract_sum_at_certificate
     AND NEW.retention_percent_at_certificate
                                    IS NOT DISTINCT FROM OLD.retention_percent_at_certificate
     AND NEW.retention_cap_percent_at_certificate
                                    IS NOT DISTINCT FROM OLD.retention_cap_percent_at_certificate
     AND NEW.advance_amount_at_certificate
                                    IS NOT DISTINCT FROM OLD.advance_amount_at_certificate
     AND NEW.advance_recovery_percent_at_certificate
                                    IS NOT DISTINCT FROM OLD.advance_recovery_percent_at_certificate THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Certificate % has been issued and its figures cannot be changed. Correct it on the next certificate — the arithmetic is cumulative.',
    NEW.certificate_number
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
