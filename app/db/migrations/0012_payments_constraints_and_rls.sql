-- ============================================================================
-- 0012 — Payments: tenant-composite keys, the over-allocation invariant,
-- derived balances, snapshot immutability, and RLS.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tenant-composite foreign keys.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_tenant_fk"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "payments" ADD CONSTRAINT "payments_account_tenant_fk"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_tenant_fk"
  FOREIGN KEY ("payment_id", "company_id") REFERENCES "payments"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. §9.2 — a payment cannot be over-allocated. Exactly.
--
--    payment.js:407 guards this as
--
--      if (this.totalAllocated > this.amount + 0.01) { ... }
--
--    so a payment can be over-allocated by up to a cent before anything
--    objects, and payment.js:372 then hides the overflow with
--    `Math.max(0, amount - totalAllocated)`. The tolerance exists because the
--    arithmetic is float64; with numeric(19,4) it is unnecessary, and without
--    it the comparison is exact.
--
--    DEFERRABLE so a caller can insert several allocations one statement at a
--    time; the total is checked once, at COMMIT.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_payment_not_over_allocated(p_payment_id uuid)
RETURNS void AS $$
DECLARE
  v_amount    numeric(19,4);
  v_allocated numeric(19,4);
  v_number    text;
BEGIN
  SELECT p.amount, p.payment_number INTO v_amount, v_number
    FROM payments p WHERE p.id = p_payment_id;

  IF NOT FOUND THEN RETURN; END IF;  -- payment deleted in this transaction

  SELECT COALESCE(SUM(a.amount_allocated), 0) INTO v_allocated
    FROM payment_allocations a WHERE a.payment_id = p_payment_id;

  IF v_allocated > v_amount THEN
    RAISE EXCEPTION
      'Payment % over-allocated: % allocated against an amount of %',
      v_number, v_allocated, v_amount
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_allocation_within_payment() RETURNS trigger AS $$
BEGIN
  PERFORM assert_payment_not_over_allocated(COALESCE(NEW.payment_id, OLD.payment_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER payment_allocations_within_payment
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_allocation_within_payment();
--> statement-breakpoint

-- Reducing a payment's amount below what is already allocated is the same
-- violation from the other direction.
CREATE OR REPLACE FUNCTION trg_payment_amount_covers_allocations() RETURNS trigger AS $$
BEGIN
  PERFORM assert_payment_not_over_allocated(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER payments_amount_covers_allocations
  AFTER UPDATE ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_payment_amount_covers_allocations();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. §9.3 — allocation totals are DERIVED.
--
--    Replaces Payment.totalAllocated and Payment.unappliedAmount, which Mongo
--    recomputes in a pre-save hook: any write that bypasses the hook leaves
--    them stale. A view cannot go stale.
--
--    unapplied is NOT clamped at zero. The Mongo version uses
--    Math.max(0, amount - totalAllocated), which turns an over-allocation into
--    a clean-looking zero. Here the constraint above makes it impossible in the
--    first place — and if it somehow occurred, the number would show negative
--    rather than hide.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "payment_balances" WITH (security_invoker = true) AS
SELECT
  p.id            AS payment_id,
  p.company_id,
  p.payment_number,
  p.payment_type,
  p.amount,
  COALESCE(SUM(a.amount_allocated), 0)::numeric(19,4) AS total_allocated,
  (p.amount - COALESCE(SUM(a.amount_allocated), 0))::numeric(19,4) AS unapplied_amount,
  (COALESCE(SUM(a.amount_allocated), 0) = p.amount) AS is_fully_applied
FROM payments p
LEFT JOIN payment_allocations a ON a.payment_id = p.id
GROUP BY p.id, p.company_id, p.payment_number, p.payment_type, p.amount;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. §9.4 — the party and account details are snapshots. Immutable.
--
--    The model calls them "Snapshot at payment time - won't change" and
--    "Cached for display". They are what the payment document recorded; a
--    renamed customer must not relabel a receipt issued last year.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_payment_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.party_name_at_payment   IS DISTINCT FROM OLD.party_name_at_payment
     OR NEW.account_code_at_payment IS DISTINCT FROM OLD.account_code_at_payment
     OR NEW.account_name_at_payment IS DISTINCT FROM OLD.account_name_at_payment
  THEN
    RAISE EXCEPTION
      'party/account snapshot columns are immutable: they record what payment % said when it was made',
      OLD.payment_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER payments_snapshot_is_immutable
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payment_snapshot_immutable();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. An allocation must point at a document that exists, in the same tenant.
--    A plain foreign key cannot express this because the target table depends
--    on document_type.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_allocation_document_exists() RETURNS trigger AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NEW.document_type = 'invoice' THEN
    SELECT EXISTS (
      SELECT 1 FROM invoices i
       WHERE i.id = NEW.document_id AND i.company_id = NEW.company_id
    ) INTO v_exists;
  ELSE
    -- bills are not ported yet; accept and re-check once the table exists.
    RETURN NEW;
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION
      'Allocation references % % which does not exist in this company',
      NEW.document_type, NEW.document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER payment_allocations_document_exists
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION trg_allocation_document_exists();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'payment_allocations']
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
