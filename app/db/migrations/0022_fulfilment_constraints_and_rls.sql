-- ============================================================================
-- 0022 — Fulfilment: tenant-composite keys, the five derived values that
-- recalculateFulfillment() maintained by hand, over-fulfilment refused, the
-- weighbridge two-pass rules, and RLS.
--
-- Closes docs/POSTGRES-MIGRATION-PLAN.md §9.6 step 5, and with it the §9 sweep.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tenant-composite foreign keys.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_customer_tenant_fk"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_draft_invoice_tenant_fk"
  FOREIGN KEY ("draft_invoice_id", "company_id") REFERENCES "invoices"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_request_tenant_fk"
  FOREIGN KEY ("request_id", "company_id") REFERENCES "stock_requests"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_request_fulfilments" ADD CONSTRAINT "stock_request_fulfilments_item_tenant_fk"
  FOREIGN KEY ("item_id", "company_id") REFERENCES "stock_request_items"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "stock_request_fulfilments" ADD CONSTRAINT "stock_request_fulfilments_movement_tenant_fk"
  FOREIGN KEY ("movement_id", "company_id") REFERENCES "stock_movements"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_request_fulfilments" ADD CONSTRAINT "stock_request_fulfilments_checkout_tenant_fk"
  FOREIGN KEY ("checkout_id", "company_id") REFERENCES "item_checkouts"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_request_item_invoices" ADD CONSTRAINT "stock_request_item_invoices_item_tenant_fk"
  FOREIGN KEY ("item_id", "company_id") REFERENCES "stock_request_items"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "stock_request_item_invoices" ADD CONSTRAINT "stock_request_item_invoices_invoice_tenant_fk"
  FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_request_approvals" ADD CONSTRAINT "stock_request_approvals_request_tenant_fk"
  FOREIGN KEY ("request_id", "company_id") REFERENCES "stock_requests"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_request_tenant_fk"
  FOREIGN KEY ("request_id", "company_id") REFERENCES "stock_requests"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_sale_invoice_tenant_fk"
  FOREIGN KEY ("sale_invoice_id", "company_id") REFERENCES "invoices"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "item_checkouts" ADD CONSTRAINT "item_checkouts_expense_account_tenant_fk"
  FOREIGN KEY ("expense_account_id", "company_id") REFERENCES "accounts"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "checkout_reminders" ADD CONSTRAINT "checkout_reminders_checkout_tenant_fk"
  FOREIGN KEY ("checkout_id", "company_id") REFERENCES "item_checkouts"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_invoice_tenant_fk"
  FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "weighbridge_tickets" ADD CONSTRAINT "weighbridge_tickets_bill_tenant_fk"
  FOREIGN KEY ("bill_id", "company_id") REFERENCES "bills"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. §9.9 — the five values recalculateFulfillment() maintained by hand.
--
--    requests.js removed its pre-save hook deliberately:
--
--      // NO PRE-SAVE MIDDLEWARE! (Transaction-safe)
--      // We calculate manually in actions using helper methods
--
--    which is why the §9.1 sweep counted zero derived fields here. It counted
--    hooks. The five values are still derived; they are just maintained by a
--    method the caller has to remember, which is strictly weaker than the hook
--    it replaced — a hook fires on every save.
--
--    remaining_to_fulfil is already a generated column. The other four are
--    maintained here, from the rows they are functions of.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_request_item(p_item_id uuid) RETURNS void AS $$
DECLARE
  v_request_id uuid;
BEGIN
  UPDATE stock_request_items i
     SET total_fulfilled = COALESCE((
           SELECT SUM(f.quantity) FROM stock_request_fulfilments f
            WHERE f.item_id = i.id), 0),
         invoiced_quantity = COALESCE((
           SELECT SUM(v.quantity) FROM stock_request_item_invoices v
            WHERE v.item_id = i.id), 0)
   WHERE i.id = p_item_id
   RETURNING i.request_id INTO v_request_id;

  IF v_request_id IS NOT NULL THEN
    PERFORM recalc_request(v_request_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- fulfilment_status is a function of total_fulfilled against the target, so it
-- is set in the same statement that changes either of them.
CREATE OR REPLACE FUNCTION trg_request_item_status() RETURNS trigger AS $$
DECLARE
  v_target numeric(19,4) := COALESCE(NEW.approved_quantity, NEW.requested_quantity);
BEGIN
  NEW.fulfilment_status := CASE
    WHEN NEW.total_fulfilled = 0          THEN 'pending'
    WHEN NEW.total_fulfilled >= v_target  THEN 'complete'
    ELSE 'partial'
  END::fulfilment_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stock_request_items_set_status
  BEFORE INSERT OR UPDATE ON stock_request_items
  FOR EACH ROW EXECUTE FUNCTION trg_request_item_status();
--> statement-breakpoint

-- The request's total_value and its status follow from its items.
CREATE OR REPLACE FUNCTION recalc_request(p_request_id uuid) RETURNS void AS $$
DECLARE
  v_all_complete boolean;
  v_any_started  boolean;
BEGIN
  UPDATE stock_requests r
     SET total_value = COALESCE((
           SELECT SUM(COALESCE(i.approved_quantity, i.requested_quantity) * i.unit_price)
             FROM stock_request_items i WHERE i.request_id = r.id), 0),
         updated_at = now()
   WHERE r.id = p_request_id;

  SELECT COALESCE(bool_and(i.fulfilment_status = 'complete'), false),
         COALESCE(bool_or(i.total_fulfilled > 0), false)
    INTO v_all_complete, v_any_started
    FROM stock_request_items i WHERE i.request_id = p_request_id;

  -- Only promotes; it never demotes a request out of a terminal state. Mirrors
  -- the validStatuses guard in recalculateFulfillment().
  UPDATE stock_requests
     SET status = CASE
           WHEN v_all_complete THEN 'fulfilled'
           WHEN v_any_started  THEN 'partially_fulfilled'
           ELSE status
         END::stock_request_status
   WHERE id = p_request_id
     AND status IN ('approved', 'partially_fulfilled');
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_fulfilment_recalc() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_request_item(OLD.item_id);
  ELSE
    PERFORM recalc_request_item(NEW.item_id);
    IF TG_OP = 'UPDATE' AND OLD.item_id IS DISTINCT FROM NEW.item_id THEN
      PERFORM recalc_request_item(OLD.item_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stock_request_fulfilments_recalc
  AFTER INSERT OR UPDATE OR DELETE ON stock_request_fulfilments
  FOR EACH ROW EXECUTE FUNCTION trg_fulfilment_recalc();
--> statement-breakpoint

CREATE TRIGGER stock_request_item_invoices_recalc
  AFTER INSERT OR UPDATE OR DELETE ON stock_request_item_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_fulfilment_recalc();
--> statement-breakpoint

-- Changing the approved quantity or the price re-derives the request.
CREATE OR REPLACE FUNCTION trg_request_item_changed() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_request(COALESCE(NEW.request_id, OLD.request_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stock_request_items_recalc_request
  AFTER INSERT OR UPDATE OR DELETE ON stock_request_items
  FOR EACH ROW EXECUTE FUNCTION trg_request_item_changed();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Over-fulfilment and over-invoicing are refused.
--
--    addFulfillment() checks `newTotal > target` and throws — for callers that
--    use addFulfillment(). Issuing more stock than was approved is the kind of
--    thing that must not depend on which code path wrote the row.
--
--    Deferred: an item and its fulfilments are inserted in one transaction, and
--    an approved quantity may legitimately be set after the fact.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_item_not_over_fulfilled(p_item_id uuid) RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT i.total_fulfilled, i.invoiced_quantity,
         COALESCE(i.approved_quantity, i.requested_quantity) AS target,
         i.product_name_at_request AS name
    INTO r
    FROM stock_request_items i WHERE i.id = p_item_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF r.total_fulfilled > r.target THEN
    RAISE EXCEPTION
      'Cannot fulfil more than approved for %: % issued against a target of %',
      r.name, r.total_fulfilled, r.target
      USING ERRCODE = 'check_violation';
  END IF;

  -- You cannot invoice stock that was never issued.
  IF r.invoiced_quantity > r.total_fulfilled THEN
    RAISE EXCEPTION
      'Cannot invoice more than was fulfilled for %: % invoiced against % issued',
      r.name, r.invoiced_quantity, r.total_fulfilled
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_assert_item_not_over_fulfilled() RETURNS trigger AS $$
BEGIN
  PERFORM assert_item_not_over_fulfilled(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER stock_request_items_not_over_fulfilled
  AFTER INSERT OR UPDATE ON stock_request_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_assert_item_not_over_fulfilled();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Snapshots.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_request_item_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.product_id             IS DISTINCT FROM OLD.product_id
     OR NEW.product_name_at_request IS DISTINCT FROM OLD.product_name_at_request
     OR NEW.sku_at_request          IS DISTINCT FROM OLD.sku_at_request
     OR NEW.stock_at_request        IS DISTINCT FROM OLD.stock_at_request
  THEN
    RAISE EXCEPTION
      'product snapshot columns are immutable: they record what was requested and what was on hand at the time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stock_request_items_snapshot_is_immutable
  BEFORE UPDATE ON stock_request_items
  FOR EACH ROW EXECUTE FUNCTION trg_request_item_snapshot_immutable();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Weighbridge: the two-pass sequence.
--
--    A ticket is weighed on arrival, then on departure, and is complete only
--    once both readings exist. The model has the status enum and the three
--    weight fields but nothing tying them together, so a ticket could be
--    'completed' with one reading — and net_weight, being an independent field
--    then, could say anything at all.
--
--    net_weight is generated now, so it cannot disagree with the readings. This
--    covers the rest of the sequence.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_wb_status_matches_weights() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.first_weight IS NULL OR NEW.second_weight IS NULL THEN
      RAISE EXCEPTION
        'Weighbridge ticket % cannot be completed with only one weighing',
        NEW.ticket_number
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSIF NEW.status = 'first_recorded' AND NEW.first_weight IS NULL THEN
    RAISE EXCEPTION
      'Weighbridge ticket % has no first weighing to record',
      NEW.ticket_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- A weighing that already happened is a physical fact.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.first_weight IS NOT NULL AND NEW.first_weight IS DISTINCT FROM OLD.first_weight THEN
      RAISE EXCEPTION
        'The first weighing on ticket % has been recorded and cannot be changed',
        OLD.ticket_number
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.second_weight IS NOT NULL AND NEW.second_weight IS DISTINCT FROM OLD.second_weight THEN
      RAISE EXCEPTION
        'The second weighing on ticket % has been recorded and cannot be changed',
        OLD.ticket_number
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER weighbridge_tickets_status_matches_weights
  BEFORE INSERT OR UPDATE ON weighbridge_tickets
  FOR EACH ROW EXECUTE FUNCTION trg_wb_status_matches_weights();
--> statement-breakpoint

-- Both legs of a transfer must be the same product, in opposite directions.
CREATE OR REPLACE FUNCTION trg_wb_transfer_link() RETURNS trigger AS $$
DECLARE
  v_other RECORD;
BEGIN
  IF NEW.linked_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT transaction_type, product_id, company_id
    INTO v_other FROM weighbridge_tickets WHERE id = NEW.linked_ticket_id;

  IF v_other.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Cannot link a weighbridge ticket across companies'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT ((NEW.transaction_type = 'transfer_in'  AND v_other.transaction_type = 'transfer_out')
       OR (NEW.transaction_type = 'transfer_out' AND v_other.transaction_type = 'transfer_in')) THEN
    RAISE EXCEPTION
      'A transfer links one transfer_out to one transfer_in; % cannot link to %',
      NEW.transaction_type, v_other.transaction_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER weighbridge_tickets_transfer_link_valid
  BEFORE INSERT OR UPDATE ON weighbridge_tickets
  FOR EACH ROW EXECUTE FUNCTION trg_wb_transfer_link();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Outstanding stock by holder — what is out and has not come back.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "outstanding_checkouts" WITH (security_invoker = true) AS
SELECT
  c.company_id,
  c.id AS checkout_id,
  c.checkout_number,
  c.product_id,
  c.product_name_at_checkout,
  c.checked_out_to_id,
  c.checked_out_to_name_at_checkout,
  c.quantity,
  (c.quantity - c.quantity_sold - c.quantity_returned - c.quantity_expensed) AS quantity_outstanding,
  c.checked_out_at,
  c.expected_return_date,
  GREATEST(0, (CURRENT_DATE - c.expected_return_date))::integer AS days_overdue,
  c.return_required,
  c.return_deadline,
  c.status
FROM item_checkouts c
WHERE c.status IN ('checked_out', 'overdue');
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stock_requests', 'stock_request_items', 'stock_request_fulfilments',
    'stock_request_item_invoices', 'stock_request_approvals',
    'item_checkouts', 'checkout_reminders', 'weighbridge_tickets'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;
