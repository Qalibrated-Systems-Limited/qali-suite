-- ============================================================================
-- 0010 — Reverses §8.6, and stores invoice source type instead of deriving it.
--
-- Both changes walk back decisions made earlier in this branch. The rule that
-- should have been applied from the start:
--
--     SNAPSHOT what a document said.  DERIVE what the ledger implies.
--
-- Names, numbers and costs at the moment of a transaction are historical facts
-- and get frozen. Balances, totals and availability are functions of other data
-- and get computed. §8.4 (quantity_available) and §8.3 (cogs_postings) sit on
-- the derive side and stand. §8.6 sat on the snapshot side and was backwards.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. §8.6 REVERSED — fulfilment details are snapshots, not a cache to drop.
--
--    §8.6 called for dropping requestNumber / technicianName / checkoutNumber
--    in favour of joins. That was the same error already corrected for
--    accountName in 0009, left un-propagated.
--
--    Accuracy: technician_name records who held the stock WHEN IT WAS ISSUED.
--    Technicians leave; records get renamed, merged or anonymised. A join makes
--    a 2024 delivery show a different name — or none — for something that
--    definitely happened.
--
--    Performance: without these, rendering invoice lines needs three extra
--    joins (stock_requests, parties, item_checkouts) purely to print a name,
--    on every line of every invoice listed.
--
--    Dropping them is worse on both counts. The foreign keys stay — they are
--    what makes the reference valid; these columns are what the document said.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "invoice_lines"
  ADD COLUMN "stock_request_number_at_sale"    text,
  ADD COLUMN "technician_name_at_sale"         text,
  ADD COLUMN "checkout_number_at_sale"         text,
  ADD COLUMN "weighbridge_ticket_number_at_sale" text;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_snapshot_fulfilment_on_line() RETURNS trigger AS $$
BEGIN
  IF NEW.stock_request_id IS NOT NULL
     AND COALESCE(NEW.stock_request_number_at_sale, '') = '' THEN
    SELECT sr.request_number, p.name
      INTO NEW.stock_request_number_at_sale, NEW.technician_name_at_sale
      FROM stock_requests sr
      LEFT JOIN parties p ON p.id = sr.technician_id
     WHERE sr.id = NEW.stock_request_id;
  END IF;

  IF NEW.checkout_id IS NOT NULL
     AND COALESCE(NEW.checkout_number_at_sale, '') = '' THEN
    SELECT c.checkout_number INTO NEW.checkout_number_at_sale
      FROM item_checkouts c WHERE c.id = NEW.checkout_id;
  END IF;

  IF NEW.weighbridge_ticket_id IS NOT NULL
     AND COALESCE(NEW.weighbridge_ticket_number_at_sale, '') = '' THEN
    SELECT w.ticket_number INTO NEW.weighbridge_ticket_number_at_sale
      FROM weighbridge_tickets w WHERE w.id = NEW.weighbridge_ticket_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoice_lines_snapshot_fulfilment
  BEFORE INSERT ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION trg_snapshot_fulfilment_on_line();
--> statement-breakpoint

-- Immutable, for the same reason as the account snapshot in 0009: a snapshot
-- nobody happens to update yet is just a cache.
CREATE OR REPLACE FUNCTION trg_fulfilment_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.stock_request_number_at_sale        IS DISTINCT FROM OLD.stock_request_number_at_sale
     OR NEW.technician_name_at_sale          IS DISTINCT FROM OLD.technician_name_at_sale
     OR NEW.checkout_number_at_sale          IS DISTINCT FROM OLD.checkout_number_at_sale
     OR NEW.weighbridge_ticket_number_at_sale IS DISTINCT FROM OLD.weighbridge_ticket_number_at_sale
  THEN
    RAISE EXCEPTION
      'fulfilment snapshot columns are immutable: they record what invoice line % said when it was raised',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoice_lines_fulfilment_snapshot_is_immutable
  BEFORE UPDATE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION trg_fulfilment_snapshot_immutable();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. §8.2 SOFTENED — source_type is stored again, and kept true by a trigger.
--
--    The original §8.2 change removed the stored column so header and lines
--    could not contradict each other. That prevents a divergence which has not
--    actually been observed, at the cost of aggregating invoice_lines on every
--    read, and of changing a field the application writes and reads today.
--
--    Storing it and maintaining it from the lines gives the same guarantee with
--    no read-time aggregation and no change to how callers use it. The
--    invoice_provenance view from 0008 stays, as a cheap way to spot drift if
--    it ever occurs.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "invoice_source_type" AS ENUM ('direct','stock_request','checkout','weighbridge','mixed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

ALTER TABLE "invoices"
  ADD COLUMN "source_type" invoice_source_type NOT NULL DEFAULT 'direct';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_refresh_invoice_source_type() RETURNS trigger AS $$
DECLARE
  v_invoice_id uuid;
  v_distinct   integer;
  v_single     text;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COUNT(DISTINCT fulfilment_source), MIN(fulfilment_source::text)
    INTO v_distinct, v_single
    FROM invoice_lines WHERE invoice_id = v_invoice_id;

  UPDATE invoices
     SET source_type = CASE
           WHEN v_distinct IS NULL OR v_distinct = 0 THEN 'direct'
           WHEN v_distinct > 1                        THEN 'mixed'
           WHEN v_single = 'inventory'                THEN 'direct'
           ELSE v_single
         END::invoice_source_type
   WHERE id = v_invoice_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoice_lines_refresh_source_type
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_invoice_source_type();
