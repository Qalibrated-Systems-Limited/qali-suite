-- ============================================================================
-- NCRS CARRY A REASON, A HANDLING RECORD, AND A SUPPLIER NOTICE
--
-- A nonconformance now says WHY it was raised (a reason from a fixed list),
-- and records how it was handled before it may close:
--
--   containment  → what was done straight away (quarantine, hold, stop issue)
--   root cause   → why it happened
--   corrective   → what stops it happening again
--   supplier     → when the supplier was told, to whom, what was sent, and
--                  what they answered. A discrepancy with a supplier on it
--                  must be forwarded to them before the NCR closes.
--
-- The rule that these must be recorded before closing is enforced in the
-- action, not by a CHECK: NCRs already closed before this existed would
-- otherwise violate it.
--
-- SAFE TO APPLY because: nullable columns plus one with a default ('other').
-- ============================================================================

ALTER TABLE "nonconformances"
  ADD COLUMN "reason_code" text DEFAULT 'other' NOT NULL,
  ADD COLUMN "containment_action" text,
  ADD COLUMN "containment_by_name" text,
  ADD COLUMN "containment_at" timestamp with time zone,
  ADD COLUMN "root_cause" text,
  ADD COLUMN "root_cause_by_name" text,
  ADD COLUMN "root_cause_at" timestamp with time zone,
  ADD COLUMN "corrective_action" text,
  ADD COLUMN "corrective_by_name" text,
  ADD COLUMN "corrective_at" timestamp with time zone,
  ADD COLUMN "supplier_notified_at" timestamp with time zone,
  ADD COLUMN "supplier_notified_to" text,
  ADD COLUMN "supplier_notified_by_name" text,
  ADD COLUMN "supplier_notified_via" text,
  ADD COLUMN "supplier_notice" text,
  ADD COLUMN "supplier_response" text,
  ADD COLUMN "supplier_response_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "nonconformances" ADD CONSTRAINT "nonconformances_reason_valid" CHECK ("reason_code" IN (
  'short_delivery', 'over_delivery', 'wrong_item', 'damaged_in_transit', 'packaging_damaged',
  'expired_or_short_dated', 'quality_failure', 'missing_documents', 'count_shortage',
  'count_surplus', 'deterioration_in_store', 'tool_damage', 'other'
));--> statement-breakpoint
ALTER TABLE "nonconformances" ADD CONSTRAINT "nonconformances_supplier_notice_complete"
  CHECK (("supplier_notified_at" IS NULL) = ("supplier_notified_by_name" IS NULL));
