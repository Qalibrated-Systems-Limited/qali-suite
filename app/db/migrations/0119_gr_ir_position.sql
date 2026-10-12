-- ============================================================================
-- GR/IR, AS A BUSINESS POSITION RATHER THAN A LEDGER BALANCE — 0119
--
-- `gr_ir_open_items` (0050) answers the accountant's question: which order
-- lines have a value received that disagrees with the value billed. It is
-- correct and it is not readable by the people who have to act on it. It has
-- no dates, so nothing can say whether a position is three days old or three
-- months; it drops matched lines, so nothing can say how much of the account
-- HAS cleared; and it expresses everything as a signed number, which is
-- accounting language:
--
--     uninvoiced_value  +20,000   ->  20,000 of goods received, not invoiced
--     uninvoiced_value  -20,000   ->  20,000 invoiced, goods not received
--
-- A procurement officer should never have to work that out from a sign. This
-- view names the direction, so the screen reads it rather than deriving it,
-- and both are then saying the same thing.
--
-- THE TWO DIRECTIONS ARE NOT THE SAME KIND OF PROBLEM, which is why they are
-- a label and not a magnitude:
--
--   awaiting_invoice  the goods are here and the supplier has not billed.
--                     Ordinary, until it is old. Ages into a liability nobody
--                     has recorded and an accrual somebody will have to guess.
--
--   awaiting_receipt  we have been billed for goods that are not recorded as
--                     received. Legitimate when billing precedes delivery, and
--                     otherwise one of: a receipt not posted, a short delivery,
--                     an over-billed quantity, a price that differs from the
--                     order, or the wrong document matched.
--
-- AGE IS THE SIGNAL, not the sign. A position at three days is procurement
-- working normally; the same figure at ninety is a control failure. `open_since`
-- is the date the position has been waiting from — the last receipt for a line
-- awaiting its invoice, the last bill for a line awaiting its goods.
--
-- WHAT THIS VIEW CANNOT SEE, stated here because the screen has to say so
-- rather than quietly under-report: it is built on purchase order LINES, and
-- `finaliseAcceptance` credits GR/IR for every finalised receipt — including
-- those raised against a bill directly, and unscheduled ones, whose lines
-- carry no `purchase_order_line_id`. Those postings are in the account balance
-- and not in this view. The difference between the two is the unattributed
-- portion, and the reconciliation screen shows it as its own figure instead of
-- presenting a subtotal as if it were the whole.
-- ============================================================================

CREATE VIEW "gr_ir_position" WITH (security_invoker = true) AS
SELECT p.*,
       (CURRENT_DATE - p.open_since)                  AS age_days,
       CASE
         WHEN p.open_since IS NULL                     THEN 'unknown'
         WHEN CURRENT_DATE - p.open_since <= 30        THEN '0-30'
         WHEN CURRENT_DATE - p.open_since <= 60        THEN '31-60'
         WHEN CURRENT_DATE - p.open_since <= 90        THEN '61-90'
         ELSE '90+'
       END                                            AS age_bucket
  FROM (
    SELECT r.company_id,
           r.purchase_order_id,
           po.po_number,
           po.supplier_id,
           po.supplier_name,
           r.purchase_order_line_id,
           pol.line_number,
           pol.description,
           pol.unit_price,
           r.ordered_quantity,
           r.received_quantity,
           r.accepted_quantity,
           b.billed_quantity,
           ROUND(r.ordered_quantity  * pol.unit_price, 4)::numeric(19,4) AS ordered_value,
           -- ACCEPTED, not received. Goods on hold pending inspection have not
           -- been bought and have not touched GR/IR; counting them here would
           -- make the screen disagree with the ledger it reconciles.
           ROUND(r.accepted_quantity * pol.unit_price, 4)::numeric(19,4) AS received_value,
           ROUND(b.billed_quantity   * pol.unit_price, 4)::numeric(19,4) AS billed_value,
           (r.accepted_quantity - b.billed_quantity)::numeric(19,4)      AS uninvoiced_quantity,
           ROUND((r.accepted_quantity - b.billed_quantity) * pol.unit_price, 4)::numeric(19,4)
                                                                          AS uninvoiced_value,
           CASE
             WHEN r.accepted_quantity > b.billed_quantity THEN 'awaiting_invoice'
             WHEN r.accepted_quantity < b.billed_quantity THEN 'awaiting_receipt'
             ELSE 'matched'
           END AS direction,
           rd.last_received_on,
           bd.last_billed_on,
           CASE
             WHEN r.accepted_quantity > b.billed_quantity THEN rd.last_received_on
             WHEN r.accepted_quantity < b.billed_quantity THEN bd.last_billed_on
           END AS open_since
      FROM purchase_order_line_received r
      JOIN purchase_order_line_billed b
        ON b.purchase_order_line_id = r.purchase_order_line_id
      JOIN purchase_order_lines pol ON pol.id = r.purchase_order_line_id
      JOIN purchase_orders po       ON po.id = r.purchase_order_id

      -- The last receipt that ADMITTED anything against this line. Finalised
      -- only: a draft receipt has posted nothing.
      LEFT JOIN LATERAL (
        SELECT MAX(grn.received_date) AS last_received_on
          FROM goods_receipt_lines grl
          JOIN goods_receipts grn ON grn.id = grl.goods_receipt_id
         WHERE grl.purchase_order_line_id = pol.id
           AND grn.status = 'finalised'
      ) rd ON TRUE

      -- The last bill against the ORDER. Deliberately coarser than the line:
      -- `purchase_order_line_billed` reaches bill lines through document_flow,
      -- and walking that recursion per row to date a position would cost more
      -- than the precision is worth. An ageing bucket does not change because
      -- two lines of one invoice are a day apart.
      LEFT JOIN LATERAL (
        SELECT MAX(bl.bill_date) AS last_billed_on
          FROM bills bl
         WHERE bl.purchase_order_id = po.id
           AND bl.status NOT IN ('cancelled', 'rejected')
      ) bd ON TRUE

      -- A line nobody has received or billed is an open ORDER, not an open
      -- GR/IR position. It has posted nothing and belongs on the PO screen.
      WHERE r.accepted_quantity <> 0 OR b.billed_quantity <> 0
  ) p;--> statement-breakpoint

GRANT SELECT ON "gr_ir_position" TO app_user;--> statement-breakpoint
