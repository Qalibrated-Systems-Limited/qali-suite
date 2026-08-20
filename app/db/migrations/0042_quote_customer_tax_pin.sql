-- ============================================================================
-- 0042 — The customer's tax PIN, snapshotted onto the quote.
--
-- 0041 snapshotted the customer's name, email, phone and address because they
-- are printed on the document the customer receives. The PIN was missed, and
-- the detail page reads it (quote.customer.taxPin).
--
-- A SNAPSHOT, NOT A JOIN, for the same reason as the rest. `parties.tax_pin`
-- exists and joining it would render today's PIN onto a quote issued last
-- quarter. A KRA PIN on a tax document is a statement about who was quoted at
-- the time; correcting the party record must not silently restate documents
-- already sent.
--
-- Its own migration rather than an edit to 0041, which has been applied.
-- ============================================================================

ALTER TABLE "quotes" ADD COLUMN "customer_tax_pin" text;
