import "server-only";

import {
  getOverdueInvoiceDigests,
  getLowStockDigests,
  getDigestRecipients,
} from "@/app/db/alerts";
import { sendInternalNotificationEmail } from "@/lib/email";
import {
  FINANCE_WRITE_ROLES,
  INVENTORY_WRITE_ROLES,
} from "@/lib/utils/role-gates";

// ============================================
// DAILY ALERT DIGESTS (run from /api/cron/notify-alerts)
// ============================================
// POSTGRES since 0102. Both aggregations read MONGO `invoices` and `products`
// and joined Mongo `users` for the recipients — collections nothing has
// written to since those modules moved, so the cron mailed tenants a summary
// of a ledger and a stock position that were years stale. An email nobody
// reads is a nuisance; an email that is believed and wrong is worse.
//
// Cross-tenant by design — this runs with no session, so scoping is
// explicit per company. One digest email per tenant per topic per run:
//  - overdue invoices  → finance roles
//  - low stock         → inventory roles
// Digest (not per-document) on purpose: a tenant with 40 overdue invoices
// should get ONE email with a summary, not 40.

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const MAX_RECIPIENTS = 25;
const MAX_LINES = 10; // top N lines listed in the email body

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/**
 * Membership is a GRANT, not a column on the user — see getDigestRecipients.
 * The Mongo query asked for `User.find({ companyId, role })`, which cannot
 * express a person holding a different role in each of two companies.
 */
async function recipientsFor(companyId, roles) {
  return getDigestRecipients(companyId, roles, MAX_RECIPIENTS);
}

/**
 * Overdue invoices, grouped per tenant.
 *
 * "Overdue" is the app's own definition — completed, not paid, past due date —
 * so this agrees with the screen the email links to. See getOverdueInvoiceDigests.
 */
export async function sendOverdueInvoiceDigests() {
  // One query across tenants: count + total + top lines per company, grouped
  // and limited in SQL. `today` is gone with it — the predicate is
  // `due_date < CURRENT_DATE`, evaluated in the database, so the digest does
  // not depend on the timezone of whichever machine the cron happened to run
  // on. The old code built midnight from the SERVER's local time and compared
  // it to stored dates, which in EAT put the boundary three hours early.
  const groups = await getOverdueInvoiceDigests(MAX_LINES);

  let sent = 0;
  for (const g of groups) {
    const to = await recipientsFor(g.companyId, FINANCE_WRITE_ROLES);
    if (to.length === 0) continue;

    const rows = g.top.map((inv) => [
      `${inv.invoiceNumber} — ${inv.customer || "Customer"}`,
      KES(inv.amountDue),
    ]);
    if (g.count > g.top.length) {
      rows.push([`…and ${g.count - g.top.length} more`, ""]);
    }

    const res = await sendInternalNotificationEmail({
      to,
      subject: `${g.count} overdue invoice${g.count === 1 ? "" : "s"} — ${KES(g.total)} outstanding`,
      label: "Overdue invoices",
      heading: `${KES(g.total)} is past due across ${g.count} invoice${g.count === 1 ? "" : "s"}`,
      rows,
      ctaUrl: `${APP_URL}/dashboard/invoices?paymentStatus=overdue`,
      ctaLabel: "Review overdue invoices",
    });
    if (res.ok) sent += 1;
  }
  return { companies: groups.length, digestsSent: sent };
}

/**
 * Low-stock products, grouped per tenant.
 *
 * Compares `quantity_available`, not on-hand — the same test
 * /dashboard/stocks?filter=low-stock applies, which is the screen this email
 * links to. Stock already committed to an order is not stock you can sell.
 */
export async function sendLowStockDigests() {
  const groups = await getLowStockDigests(MAX_LINES);

  let sent = 0;
  for (const g of groups) {
    const to = await recipientsFor(g.companyId, INVENTORY_WRITE_ROLES);
    if (to.length === 0) continue;

    const rows = g.top.map((p) => [
      `${p.sku} — ${p.name}`,
      `${p.qty} on hand (reorder at ${p.reorder})`,
    ]);
    if (g.count > g.top.length) {
      rows.push([`…and ${g.count - g.top.length} more`, ""]);
    }

    const res = await sendInternalNotificationEmail({
      to,
      subject: `${g.count} product${g.count === 1 ? "" : "s"} at or below reorder level`,
      label: "Low stock",
      heading: `${g.count} product${g.count === 1 ? "" : "s"} need${g.count === 1 ? "s" : ""} reordering`,
      rows,
      ctaUrl: `${APP_URL}/dashboard/stocks?filter=low-stock`,
      ctaLabel: "Review stock levels",
    });
    if (res.ok) sent += 1;
  }
  return { companies: groups.length, digestsSent: sent };
}
