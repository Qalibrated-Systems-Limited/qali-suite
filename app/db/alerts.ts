import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";
import { arrayOf } from "./repositories/sqlHelpers";

/**
 * The daily alert digests, on Postgres — 0102.
 *
 * `lib/notifications/alert-digests.js` ran two MONGO aggregations over
 * `invoices` and `products`, joined to Mongo `users` for the recipients. Both
 * collections moved to Postgres long ago, so the cron was emailing tenants
 * about an overdue ledger and a stock position that nothing had written to
 * since — an email that is worse than no email, because it is believed.
 *
 * PRIVILEGED, NOT TENANT-SCOPED, and this is the second place that is correct
 * (the SuperAdmin platform dashboard is the other). The digest runs on a cron
 * with no session and reports per tenant, which no tenant-scoped connection
 * can do. It is reached only from /api/cron/notify-alerts behind CRON_SECRET.
 *
 * ONE QUERY PER TOPIC, not one per tenant. The company grouping, the counts,
 * the totals and the top-N lines are all computed in SQL, so a estate with 400
 * companies is two round trips rather than eight hundred.
 */

/** Rows the email body lists before collapsing into "…and N more". */
const MAX_LINES = 10;

export interface OverdueDigest {
  companyId: string;
  count: number;
  total: number;
  top: Array<{
    invoiceNumber: string;
    customer: string | null;
    amountDue: number;
    dueDate: string | null;
  }>;
}

/**
 * Overdue invoices per tenant.
 *
 * OVERDUE IS DERIVED, and this uses the app's own definition verbatim —
 * `status = 'completed' AND payment_status <> 'paid' AND due_date <
 * CURRENT_DATE` — which is what `getInvoiceStats` and the finance tab use, and
 * what the partial index `(company_id, due_date) WHERE status = 'completed'
 * AND payment_status <> 'paid'` is built for.
 *
 * TWO DELIBERATE DIVERGENCES FROM THE MONGO VERSION:
 *
 *   1. It matched `status IN ('sent', 'completed')`. Postgres treats only
 *      'completed' as overdue-eligible, on the stated grounds that nobody has
 *      been asked to pay a draft. The email links to
 *      /dashboard/invoices?paymentStatus=overdue, and an email that counts
 *      differently from the screen it links to is a support ticket.
 *
 *   2. It matched `paymentStatus: 'overdue'` among others. There is no such
 *      payment status here — §9B.2 declined to carry it precisely because a
 *      status that has to be recomputed from a date every night is a date, not
 *      a status.
 *
 * `amount_due` is COMPUTED. Mongo stored it and matched `$gt: 0`; here it is
 * `total - amount_paid`, because a stored balance and the payments that make
 * it up drift the moment one write lands without the other.
 */
export async function getOverdueInvoiceDigests(
  maxLines = MAX_LINES,
): Promise<OverdueDigest[]> {
  const rows = (await privilegedDb().execute(sql`
    WITH overdue AS (
      SELECT i.company_id,
             i.invoice_number,
             p.name AS customer_name,
             (i.total - i.amount_paid) AS amount_due,
             i.due_date,
             row_number() OVER (PARTITION BY i.company_id ORDER BY i.due_date)
               AS rn,
             count(*)  OVER (PARTITION BY i.company_id) AS company_count,
             sum(i.total - i.amount_paid)
               OVER (PARTITION BY i.company_id)         AS company_total
        FROM invoices i
        -- LEFT, so an invoice whose party row is missing is still chased
        -- rather than silently dropped from the total.
        LEFT JOIN parties p ON p.id = i.customer_id
       WHERE i.status = 'completed'
         AND i.payment_status <> 'paid'
         AND i.due_date IS NOT NULL
         AND i.due_date < CURRENT_DATE
         AND (i.total - i.amount_paid) > 0
    )
    SELECT company_id,
           company_count::int        AS count,
           company_total::float8     AS total,
           json_agg(
             json_build_object(
               'invoiceNumber', invoice_number,
               'customer',      customer_name,
               'amountDue',     amount_due::float8,
               'dueDate',       due_date
             ) ORDER BY rn
           ) FILTER (WHERE rn <= ${maxLines}) AS top
      FROM overdue
     GROUP BY company_id, company_count, company_total
     ORDER BY company_total DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    companyId: String(r.company_id),
    count: Number(r.count),
    // float8 in the query, because money is numeric(19,4) and arrives as a
    // STRING otherwise — `KES(total)` would then format a concatenation.
    total: Number(r.total),
    top: (r.top as OverdueDigest["top"]) ?? [],
  }));
}

export interface LowStockDigest {
  companyId: string;
  count: number;
  top: Array<{
    sku: string;
    name: string;
    qty: number;
    reorder: number;
  }>;
}

/**
 * Products at or below their reorder level, per tenant.
 *
 * ON `quantity_available`, NOT `quantity_on_hand`. Mongo compared on-hand, but
 * `getLowStock` — which backs /dashboard/stocks?filter=low-stock, the screen
 * this email links to — compares available, and available is the honest
 * question: stock already committed to an order is not stock you can sell.
 * Matching the screen matters more here than matching the collection being
 * deleted.
 */
export async function getLowStockDigests(
  maxLines = MAX_LINES,
): Promise<LowStockDigest[]> {
  const rows = (await privilegedDb().execute(sql`
    WITH low AS (
      SELECT company_id, sku, name,
             quantity_available, reorder_level,
             row_number() OVER (
               PARTITION BY company_id
               ORDER BY (quantity_available - reorder_level) ASC
             ) AS rn,
             count(*) OVER (PARTITION BY company_id) AS company_count
        FROM products
       WHERE is_active = true
         AND reorder_level > 0
         AND quantity_available <= reorder_level
    )
    SELECT company_id,
           company_count::int AS count,
           json_agg(
             json_build_object(
               'sku',     sku,
               'name',    name,
               'qty',     quantity_available::float8,
               'reorder', reorder_level::float8
             ) ORDER BY rn
           ) FILTER (WHERE rn <= ${maxLines}) AS top
      FROM low
     GROUP BY company_id, company_count
     ORDER BY company_count DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    companyId: String(r.company_id),
    count: Number(r.count),
    top: (r.top as LowStockDigest["top"]) ?? [],
  }));
}

/**
 * Who to send a tenant's digest to.
 *
 * MEMBERSHIP IS A GRANT HERE, not a column on the user. Mongo asked for
 * `User.find({ companyId, role: { $in: roles } })`, which cannot express the
 * thing this app has modelled since 0033: a person may hold access to several
 * companies, and their role can differ in each.
 *
 * So the role tested is `COALESCE(grant.role, users.role)` — the same
 * resolution `withAuthorizedTenant` and `resolveRoleForCompany` perform. A user
 * promoted to Finance Manager in one company gets that company's finance
 * digest and not another's, which the Mongo query got wrong in both directions.
 *
 * Both the grant and the user must be active: a suspended grant is a person
 * who has been removed from the company, and mailing them its receivables is
 * the failure this check exists to prevent.
 */
export async function getDigestRecipients(
  companyId: string,
  roles: readonly string[],
  max = 25,
): Promise<string[]> {
  if (!roles.length) return [];

  const rows = (await privilegedDb().execute(sql`
    SELECT DISTINCT u.email
      FROM user_company_access a
      JOIN users u ON u.id = a.user_id
     WHERE a.company_id = ${companyId}::uuid
       AND a.status = 'active'
       AND u.status = 'active'
       AND u.email IS NOT NULL
       AND COALESCE(a.role, u.role) = ANY(${arrayOf([...roles], "text[]")})
     LIMIT ${Math.min(Math.max(Number(max) || 25, 1), 200)}
  `)) as unknown as Array<{ email: string }>;

  return rows.map((r) => String(r.email)).filter(Boolean);
}
