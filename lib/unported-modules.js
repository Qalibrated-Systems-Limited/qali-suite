/**
 * Modules whose entry points are switched off because the stores beneath them
 * have moved and they have not.
 *
 * This is not a plan gate (lib/plan-gate.js) and not a permission — the
 * feature is not withheld from the user, it is broken. Keeping the buttons
 * live means offering a flow that cannot complete, and the failure is quiet
 * at three of its four steps.
 *
 * ── SALES ORDERS ────────────────────────────────────────────────────────────
 *
 * Reported from the running app as "create sales order from quote: invalid
 * id". That is the FIRST of four failures, and the only loud one:
 *
 *   sales-order-actions.js:56   `ObjectId.isValid(quoteId)` — the quote id is
 *                               a Postgres uuid since §9E, so this rejects it.
 *   sales-order-actions.js:64   reads the Mongo `Quote` collection. Nothing
 *                               writes it any more: nothing in the app imports
 *                               `mongodb/actions/quote-actions` or
 *                               `mongodb/queries/quote-queries`. Every lookup
 *                               would miss.
 *   sales-order-actions.js:187  commits stock against Mongo `Product`
 *                               counters. Products are Postgres; the
 *                               reservation would be taken from a store the
 *                               inventory screens do not read.
 *   sales-order-actions.js:392  `Invoice.create` — a MONGO invoice, while
 *                               every invoice screen reads Postgres. This is
 *                               the §9E defect exactly, surviving here.
 *
 * Relaxing the id check alone would change the error message without making
 * the feature work, and would move the failure from step one to step four,
 * where it is invisible.
 *
 * The module posts no journal entries, so it is not an eighth ledger gap. It
 * is a stranded-store gap: 466 action lines, a 270-line model and three
 * screens reading three stores that have all moved out from under it.
 *
 * TO RE-ENABLE: port it, then delete the flag and the guards that read it.
 * The guards are deliberately a single named import so they are findable —
 * `grep -rn SALES_ORDERS_AVAILABLE`.
 */
export const SALES_ORDERS_AVAILABLE = false;

/** Shown wherever the entry point used to be. */
export const SALES_ORDERS_UNAVAILABLE_REASON =
  "Sales orders are unavailable while the module is moved to the new database. Quotes convert straight to invoices in the meantime.";
