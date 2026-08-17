-- ============================================================================
-- 0019 — Tax transactions: tenant-composite keys, the filing-period default,
-- source-document validation, snapshot and filing immutability, the VAT return
-- view, and RLS.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tenant-composite foreign keys.
--
--    party_id is a bare String with no ref in Mongo, so nothing checked that
--    the party on a filed return existed. Same gap parties closed for
--    journal_entries in 0006.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_party_tenant_fk"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_account_tenant_fk"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. filing_period defaults from the transaction date.
--
--    Mongo derives it at every call site with the same four lines of
--    getFullYear/getMonth string building. Here the default is in one place and
--    the column stays settable, because a transaction can be filed in a later
--    period than it falls in — something the derive-every-time rule cannot say.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_tax_filing_period_default() RETURNS trigger AS $$
BEGIN
  IF NEW.filing_period IS NULL OR NEW.filing_period = '' THEN
    NEW.filing_period := to_char(NEW.transaction_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER tax_transactions_default_filing_period
  BEFORE INSERT ON tax_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_tax_filing_period_default();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The source document must exist, in the same tenant.
--
--    Mongo uses `refPath: "sourceDocument.type"`, which tells Mongoose how to
--    populate but enforces nothing on write. A plain foreign key cannot express
--    this because the target table depends on the type — same treatment as
--    payment_allocations in 0012.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_tax_source_document_exists() RETURNS trigger AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NEW.source_document_type = 'invoice' THEN
    SELECT EXISTS (SELECT 1 FROM invoices i
                    WHERE i.id = NEW.source_document_id AND i.company_id = NEW.company_id)
      INTO v_exists;
  ELSIF NEW.source_document_type = 'bill' THEN
    SELECT EXISTS (SELECT 1 FROM bills b
                    WHERE b.id = NEW.source_document_id AND b.company_id = NEW.company_id)
      INTO v_exists;
  ELSIF NEW.source_document_type = 'journal_entry' THEN
    SELECT EXISTS (SELECT 1 FROM journal_entries e
                    WHERE e.id = NEW.source_document_id AND e.company_id = NEW.company_id)
      INTO v_exists;
  ELSE
    -- 'other': no table to check against, by definition.
    RETURN NEW;
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION
      'Tax transaction references % % which does not exist in this company',
      NEW.source_document_type, NEW.source_document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER tax_transactions_source_document_exists
  BEFORE INSERT OR UPDATE ON tax_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_tax_source_document_exists();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Snapshots: what the return said when it was raised.
--
--    §9.1 counted no snapshot fields in this model, but the party block and the
--    account code/name are the same pattern as everywhere else — and the case
--    for freezing them is stronger here than anywhere. This is a statutory
--    filing. The supplier's name and PIN on a return submitted to KRA are what
--    was submitted; renaming the supplier next year must not rewrite it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_tax_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.party_id                    IS DISTINCT FROM OLD.party_id
     OR NEW.party_name_at_transaction    IS DISTINCT FROM OLD.party_name_at_transaction
     OR NEW.party_tax_pin_at_transaction IS DISTINCT FROM OLD.party_tax_pin_at_transaction
     OR NEW.account_id                   IS DISTINCT FROM OLD.account_id
     OR NEW.account_code_at_transaction  IS DISTINCT FROM OLD.account_code_at_transaction
     OR NEW.account_name_at_transaction  IS DISTINCT FROM OLD.account_name_at_transaction
  THEN
    RAISE EXCEPTION
      'party/account snapshot columns are immutable: they record what tax transaction % stated',
      OLD.transaction_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER tax_transactions_snapshot_is_immutable
  BEFORE UPDATE ON tax_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_tax_snapshot_immutable();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Filing, remittance and certificates are one-way, and ordered.
--
--    taxTransactions.js enforces the ordering in three methods:
--      markAsRemitted()   — only WHT
--      issueCertificate() — only WHT, only after remittance, only once
--    Those checks hold only for callers that go through the methods. The rules
--    are about a statutory obligation having been discharged, so they belong
--    where nothing can route around them.
--
--    Un-filing is not an amendment. If a return was wrong, the correction is
--    another transaction, not editing the record of what was submitted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_tax_filing_transitions() RETURNS trigger AS $$
BEGIN
  IF OLD.filed AND NOT NEW.filed THEN
    RAISE EXCEPTION
      'Tax transaction % is already filed; correct it with an adjusting transaction rather than un-filing it',
      OLD.transaction_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.remitted AND NOT NEW.remitted THEN
    RAISE EXCEPTION
      'Tax transaction % is already remitted', OLD.transaction_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.remitted AND NOT OLD.remitted
     AND NEW.tax_type NOT IN ('wht', 'paye', 'nssf', 'shif', 'nhif', 'housing_levy') THEN
    RAISE EXCEPTION
      'Only withholding and payroll taxes are remitted to KRA; % is %',
      OLD.transaction_number, NEW.tax_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.certificate_issued AND NOT OLD.certificate_issued THEN
    IF NEW.tax_type <> 'wht' THEN
      RAISE EXCEPTION
        'Only WHT transactions have certificates; % is %',
        OLD.transaction_number, NEW.tax_type
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT NEW.remitted THEN
      RAISE EXCEPTION
        'WHT % must be remitted before a certificate is issued', OLD.transaction_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.certificate_issued AND NEW.certificate_number IS DISTINCT FROM OLD.certificate_number THEN
    RAISE EXCEPTION
      'Certificate % has already been issued for %',
      OLD.certificate_number, OLD.transaction_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER tax_transactions_filing_transitions
  BEFORE UPDATE ON tax_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_tax_filing_transitions();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. The VAT return, as a view.
--
--    Replaces getVATReturn()'s two $group pipelines and the JavaScript
--    subtraction between them. `vat_payable` is output minus input; negative
--    means refundable, and it is reported signed rather than through Mongo's
--    `Math.abs(...)` pair, which turns one number into two that must be read
--    together to know the direction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "vat_return" WITH (security_invoker = true) AS
SELECT
  company_id,
  filing_period,
  COALESCE(SUM(base_amount) FILTER (WHERE tax_type = 'vat_input'), 0)::numeric(19,4)  AS input_base,
  COALESCE(SUM(tax_amount)  FILTER (WHERE tax_type = 'vat_input'), 0)::numeric(19,4)  AS input_tax,
  COUNT(*)                  FILTER (WHERE tax_type = 'vat_input')                     AS input_count,
  COALESCE(SUM(base_amount) FILTER (WHERE tax_type = 'vat_output'), 0)::numeric(19,4) AS output_base,
  COALESCE(SUM(tax_amount)  FILTER (WHERE tax_type = 'vat_output'), 0)::numeric(19,4) AS output_tax,
  COUNT(*)                  FILTER (WHERE tax_type = 'vat_output')                    AS output_count,
  (COALESCE(SUM(tax_amount) FILTER (WHERE tax_type = 'vat_output'), 0)
   - COALESCE(SUM(tax_amount) FILTER (WHERE tax_type = 'vat_input'), 0))::numeric(19,4) AS vat_payable
FROM tax_transactions
WHERE tax_type IN ('vat_input', 'vat_output')
GROUP BY company_id, filing_period;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "tax_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tax_transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tax_transactions"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
