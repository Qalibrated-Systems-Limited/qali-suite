-- ============================================================================
-- 0063 — The payment columns the form already posts, and the one cancel needs.
--
-- The payments table shipped with 0011, before there was an action layer above
-- it. `PaymentForm` has been submitting five fields that had nowhere to land:
-- `notes` had a column and no argument, and `mpesaPhoneNumber` and `bankName`
-- had neither. A user who typed the payer's M-Pesa number watched it vanish on
-- submit. That is rule 4 of the porting list — "forms first, and completely" —
-- and it is exactly the kind of miss the form surfaces and nothing else does.
--
-- `cancellation_reason` is new for a different reason: cancelling a payment is
-- being wired for the first time here. Mongo records `cancelledAt`,
-- `cancelledBy` and `cancellationReason`; 0011 brought the first two across and
-- dropped the third, because nothing was cancelling anything yet.
--
-- ── The pair constraint ─────────────────────────────────────────────────────
--
-- Three columns describe one event, so all three are present together or none
-- of them are — and the condition is the STATUS, not one of the columns. A
-- CHECK written as "if cancelled_at then cancelled_by_id" would still permit a
-- row with status = 'cancelled' and all three NULL, which is the case that
-- actually happens: an UPDATE that sets the status and forgets the rest.
--
-- Stated as a conditional on the status, the database refuses that write. The
-- audit trail on the detail page then cannot render a cancellation with no
-- cancelling user, because such a row cannot exist.
-- ============================================================================

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mpesa_phone" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bank_name" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;--> statement-breakpoint

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_cancellation_pair";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cancellation_pair" CHECK (
  CASE WHEN "payments"."status" = 'cancelled'
       THEN "payments"."cancelled_at" IS NOT NULL
        AND "payments"."cancelled_by_id" IS NOT NULL
        AND "payments"."cancellation_reason" IS NOT NULL
       ELSE "payments"."cancelled_at" IS NULL
        AND "payments"."cancelled_by_id" IS NULL
        AND "payments"."cancellation_reason" IS NULL
  END
);--> statement-breakpoint

-- A cancelled payment settles nothing. `cancelPayment` deletes the allocation
-- rows so the invoice and bill triggers give the balance back; this refuses
-- the state where that step was skipped and the document still shows the
-- money as received.
ALTER TABLE "payment_allocations" DROP CONSTRAINT IF EXISTS "payment_allocations_payment_not_cancelled";--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_allocation_payment_not_cancelled()
RETURNS trigger AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status::text INTO v_status FROM payments WHERE id = NEW.payment_id;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot allocate a cancelled payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS payment_allocations_payment_not_cancelled ON payment_allocations;--> statement-breakpoint
CREATE TRIGGER payment_allocations_payment_not_cancelled
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION trg_allocation_payment_not_cancelled();--> statement-breakpoint

-- The list page filters and sorts on these; 0011 indexed company+date and
-- company+status but not the method, which the "Method" column offers as a
-- filter and the search box reaches through.
CREATE INDEX IF NOT EXISTS "payments_company_method_idx"
  ON "payments" USING btree ("company_id", "payment_method");
