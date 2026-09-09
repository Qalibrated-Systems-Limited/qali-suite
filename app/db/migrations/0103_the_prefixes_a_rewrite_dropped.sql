-- ─────────────────────────────────────────────────────────────────────────────
-- 0103 — The prefixes a rewrite dropped.
--
-- `document_prefix(company, kind)` turns a document kind into the prefix its
-- numbers carry — the company's configured one, or a default. It has been
-- redefined five times, once per module that added a numbered document:
--
--   0035  invoice, bill, quote, po
--   0050  + grn
--   0051  + ncr
--   0052  + claim
--   0056  + asset
--   0098  + sales_order       ... and MINUS asset, ncr and claim.
--
-- 0098 was written from an older copy of the function — the 0050-era one — so
-- it added its own kind and silently dropped the three that 0051, 0052 and 0056
-- had added in between. `CREATE OR REPLACE FUNCTION` does exactly what it is
-- asked to and replaces the body wholesale, so nothing complained.
--
-- ── WHAT IT ACTUALLY BROKE ────────────────────────────────────────────────
--
-- Both halves of the function lost those three branches: the LOOKUP that reads
-- `company_settings`, and the DEFAULT. What remains is `ELSE upper(p_kind)`.
--
--   asset  -> 'ASSET'   VISIBLY WRONG. The documented default is 'AST', and
--                       `tests/pg-assets.test.mjs` has been failing on
--                       `expected 'ASSET-00001' to match /^AST-/` ever since.
--
--   ncr    -> 'NCR'     Accidentally correct. upper('ncr') is 'NCR', which is
--   claim  -> 'CLAIM'   also the documented default, so nothing looked wrong.
--
-- That accident is why this survived: two of the three kinds produce the right
-- string through the wrong path, and the third was dismissed as a failing test.
--
-- The part no test covered is the LOOKUP, and it is the part that matters to a
-- customer: `company_settings.asset_prefix`, `.ncr_prefix` and `.claim_prefix`
-- are real, settable columns, and since 0098 all three have been IGNORED. A
-- company that set its asset prefix to "FA" got 'ASSET' anyway, with no error
-- and nothing to indicate the setting had been read and discarded.
--
-- ── THE FIX, AND THE GUARD ────────────────────────────────────────────────
--
-- The function below is the union of every kind any migration has ever taught
-- it, which is the definition 0098 should have started from. `ELSE
-- upper(p_kind)` stays as a last resort for a kind nobody has registered yet,
-- but no kind that has a column relies on it any more.
--
-- `tests/pg-numbering.test.mjs` now asserts every kind resolves BOTH ways —
-- the configured prefix and the default — so the next redefinition that drops
-- a branch fails immediately instead of in four migrations' time.
--
-- ── NUMBERING DISCONTINUITY ───────────────────────────────────────────────
--
-- `entry_counters` is keyed by (company, prefix), so assets numbered while the
-- function was wrong sit under 'ASSET' and new ones start at AST-00001. There
-- is no collision — the prefixes differ — but a database that already has
-- ASSET-prefixed assets will show a break in the series. Nothing is renumbered
-- here: an asset number is on a fixed-asset register and may be on a physical
-- tag, and rewriting one to tidy a sequence is worse than the gap.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION document_prefix(p_company_id uuid, p_kind text)
RETURNS text AS $$
DECLARE
  v_prefix text;
BEGIN
  /*
   * EVERY KIND THAT HAS A COLUMN MUST APPEAR HERE. A kind missing from this
   * CASE does not error — it returns NULL, falls through to the defaults
   * below, and the company's configured prefix is discarded in silence. That
   * is the failure 0098 introduced.
   */
  SELECT CASE p_kind
           WHEN 'invoice'     THEN s.invoice_prefix
           WHEN 'bill'        THEN s.bill_prefix
           WHEN 'quote'       THEN s.quote_prefix
           WHEN 'po'          THEN s.po_prefix
           WHEN 'grn'         THEN s.grn_prefix
           WHEN 'sales_order' THEN s.sales_order_prefix
           WHEN 'ncr'         THEN s.ncr_prefix     -- restored (0051)
           WHEN 'claim'       THEN s.claim_prefix   -- restored (0052)
           WHEN 'asset'       THEN s.asset_prefix   -- restored (0056)
         END
    INTO v_prefix
    FROM company_settings s
   WHERE s.company_id = p_company_id;

  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := CASE p_kind
                  WHEN 'invoice'     THEN 'INV'
                  WHEN 'bill'        THEN 'BILL'
                  WHEN 'quote'       THEN 'QT'
                  WHEN 'po'          THEN 'PO'
                  WHEN 'grn'         THEN 'GRN'
                  WHEN 'sales_order' THEN 'SO'
                  WHEN 'ncr'         THEN 'NCR'     -- restored (0051)
                  WHEN 'claim'       THEN 'CLAIM'   -- restored (0052)
                  WHEN 'asset'       THEN 'AST'     -- restored (0056)
                  /*
                   * Last resort for a kind no migration has registered. Two of
                   * the three kinds above reached the right answer through
                   * here, which is precisely why the regression was invisible.
                   */
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;
