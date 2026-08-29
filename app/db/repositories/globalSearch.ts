import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { likeContains, likePrefix } from "./sqlHelpers";

/**
 * The command palette's search — every entity it offers, in one round trip.
 *
 * WHAT THIS REPLACES. `app/mongodb/actions/global-search-action.js` fanned out
 * across the Mongo `Product`, `Invoice`, `Quote`, `Bill`, `Party`,
 * `StockRequest` and `Project` models. All seven of those collections moved to
 * Postgres, and only claims was ever repointed — so Ctrl-K had been returning
 * navigation entries and nothing else since products ported. Nothing errored:
 * a search that finds nothing is indistinguishable from a search with no
 * matches, which is why it survived seven module ports.
 *
 * WHY A UNION RATHER THAN THE EIGHT LIST FUNCTIONS. Each module already has a
 * `search*` in its own repository, and calling all eight would have been the
 * faithful port. But they are LIST queries built for a page: `searchProducts`
 * carries a `COUNT(*) OVER ()`, `listProjects` runs four more queries for
 * budget, actuals and progress, `searchStockRequests` joins a totals subquery
 * for a progress bar. A palette renders five fields per row and throws the
 * rest away — and this runs on a 300ms debounce, so it is the most
 * frequently-executed query in the app. Eight calls, twenty-odd queries, per
 * keystroke.
 *
 * So each branch selects only what the palette draws, and they go down one
 * connection as one statement.
 *
 * THE COST OF THAT CHOICE, stated plainly: the match predicates are restated
 * here rather than shared with the list pages, so they can drift. They are
 * deliberately the SAME columns each module's own search uses — check
 * `searchProducts`, `searchInvoices`, `searchBills`, `searchQuotes`,
 * `searchParties`, `searchStockRequests`, `listClaims` and `listProjects` if
 * you change one. A test pins each branch against its module's search.
 *
 * No company filter appears anywhere below. RLS supplies it on every table.
 */

/** The sections the palette renders, in the order it renders them. */
export type SearchKind =
  | "product"
  | "invoice"
  | "quote"
  | "bill"
  | "customer"
  | "supplier"
  | "claim"
  | "stockRequest"
  | "project";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** The bold half of the row: a document number, or a name where there is none. */
  title: string | null;
  /** The muted half: the counterparty, the SKU, the project name. */
  subtitle: string | null;
  status: string | null;
  /** Numeric as text — the caller formats. Null where the row has no money on it. */
  amount: string | null;
  /** The one extra field a section needs: quantity, department, claim type. */
  meta: string | null;
}

export interface GlobalSearchOptions {
  /** Which sections to run. Anything omitted costs nothing — its branch is not built. */
  kinds: readonly SearchKind[];
  /** Rows per section. The palette shows four. */
  limit?: number;
  /**
   * Restricts claims to one person's own. Set for anyone who cannot review
   * claims, so the palette does not become a window onto every colleague's
   * reimbursements — see the note in search-actions.ts.
   */
  ownClaimsUserId?: string | null;
}

/**
 * One branch of the UNION, with all eight columns named.
 *
 * EVERY branch must alias, not just the first. A UNION takes its output column
 * names from whichever branch comes FIRST, and which branch that is depends on
 * the reader's role — a Storekeeper gets no invoices, so the invoice branch is
 * not built for them. Alias in one branch only and the result columns are
 * named after that branch's expressions for some users and not others, and the
 * mapping at the bottom of this file silently reads undefined.
 *
 * `rank` is 0 when the term matches the row's IDENTIFIER — its number, its SKU
 * — and 1 when it only matches a name or a description. Sorting on it puts
 * "INV-0042" above the six invoices merely belonging to a customer whose name
 * contains "inv". Mongo had no ordering beyond `createdAt`, so the document
 * whose number you typed could be missing from the top four entirely.
 */
function branch(parts: {
  kind: SearchKind;
  id: SQL;
  title: SQL;
  subtitle: SQL;
  status?: SQL;
  amount?: SQL;
  meta?: SQL;
  rank: SQL;
  from: SQL;
  where: SQL;
  /** Tie-break inside a rank, before the LIMIT cuts the section to four. */
  order: SQL;
  limit: number;
}) {
  const nul = sql`NULL::text`;
  return sql`(
    SELECT ${parts.kind}::text        AS kind,
           ${parts.id}                AS id,
           ${parts.title}             AS title,
           ${parts.subtitle}          AS subtitle,
           ${parts.status ?? nul}     AS status,
           ${parts.amount ?? nul}     AS amount,
           ${parts.meta ?? nul}       AS meta,
           ${parts.rank}              AS rank
      FROM ${parts.from}
     WHERE ${parts.where}
     ORDER BY rank, ${parts.order}
     LIMIT ${parts.limit}
  )`;
}

export async function globalSearch(
  tx: Tx,
  term: string,
  opts: GlobalSearchOptions,
): Promise<SearchHit[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const limit = Math.min(Math.max(opts.limit ?? 4, 1), 25);
  const any = likeContains(q);
  const starts = likePrefix(q);
  const want = new Set(opts.kinds);
  const branches: SQL[] = [];

  if (want.has("product")) {
    branches.push(
      branch({
        kind: "product",
        from: sql`products p`,
        id: sql`p.id::text`,
        title: sql`p.name`,
        subtitle: sql`p.sku`,
        meta: sql`p.quantity_on_hand::text`,
        rank: sql`CASE WHEN p.sku ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`p.name ILIKE ${any} OR p.sku ILIKE ${any}`,
        order: sql`p.name`,
        limit,
      }),
    );
  }

  if (want.has("invoice")) {
    branches.push(
      branch({
        kind: "invoice",
        from: sql`invoices i JOIN parties pa ON pa.id = i.customer_id`,
        id: sql`i.id::text`,
        title: sql`i.invoice_number`,
        subtitle: sql`pa.name`,
        status: sql`i.status::text`,
        amount: sql`i.total::text`,
        rank: sql`CASE WHEN i.invoice_number ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`i.invoice_number ILIKE ${any} OR pa.name ILIKE ${any}`,
        order: sql`i.invoice_date DESC, i.invoice_number DESC`,
        limit,
      }),
    );
  }

  if (want.has("quote")) {
    branches.push(
      branch({
        kind: "quote",
        from: sql`quotes q`,
        id: sql`q.id::text`,
        title: sql`q.quote_number`,
        // Denormalised on the quote, unlike the invoice's join: quotes carry a
        // customer_name column of their own.
        subtitle: sql`q.customer_name`,
        status: sql`q.status::text`,
        amount: sql`q.total::text`,
        rank: sql`CASE WHEN q.quote_number ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`q.quote_number ILIKE ${any} OR q.customer_name ILIKE ${any}`,
        order: sql`q.quote_date DESC, q.created_at DESC`,
        limit,
      }),
    );
  }

  if (want.has("bill")) {
    branches.push(
      branch({
        kind: "bill",
        from: sql`bills b`,
        id: sql`b.id::text`,
        title: sql`b.bill_number`,
        // The SNAPSHOT taken at the bill, not the supplier's name today — a
        // rename must not relabel what was already billed (§9.4).
        subtitle: sql`b.supplier_name_at_bill`,
        status: sql`b.status::text`,
        amount: sql`b.total::text`,
        rank: sql`CASE WHEN b.bill_number ILIKE ${starts}
                         OR b.supplier_invoice_number ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`b.bill_number ILIKE ${any}
                   OR b.supplier_invoice_number ILIKE ${any}
                   OR b.supplier_name_at_bill ILIKE ${any}`,
        order: sql`b.bill_date DESC, b.bill_number DESC`,
        limit,
      }),
    );
  }

  // Customers and suppliers are two sections of the palette and one table. A
  // party that is both appears in both, which is what the Mongo version did
  // with its `type: {$in: ["customer","both"]}` pair.
  for (const [kind, flag] of [
    ["customer", sql`p.is_customer`],
    ["supplier", sql`p.is_supplier`],
  ] as const) {
    if (!want.has(kind)) continue;
    branches.push(
      branch({
        kind,
        from: sql`parties p`,
        id: sql`p.id::text`,
        title: sql`COALESCE(NULLIF(p.display_name, ''), p.name)`,
        subtitle: sql`p.email`,
        rank: sql`CASE WHEN p.name ILIKE ${starts}
                         OR p.display_name ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`${flag} AND p.is_active
                   AND (p.name ILIKE ${any}
                        OR p.display_name ILIKE ${any}
                        OR p.email ILIKE ${starts})`,
        order: sql`p.name`,
        limit,
      }),
    );
  }

  if (want.has("claim")) {
    branches.push(
      branch({
        kind: "claim",
        // total_amount is derived by the employee_claim_state view, never
        // stored — see the note at the top of claims.ts.
        from: sql`employee_claims c
                  JOIN employee_claim_state s ON s.claim_id = c.id
                  JOIN parties p ON p.id = c.party_id`,
        id: sql`c.id::text`,
        title: sql`c.claim_number`,
        subtitle: sql`p.name`,
        status: sql`c.status::text`,
        amount: sql`s.total_amount::text`,
        meta: sql`c.claim_type::text`,
        rank: sql`CASE WHEN c.claim_number ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`(c.claim_number ILIKE ${any}
                    OR c.description ILIKE ${any}
                    OR p.name ILIKE ${any})
                   ${
                     opts.ownClaimsUserId
                       ? sql`AND c.employee_user_id = ${String(opts.ownClaimsUserId)}`
                       : sql``
                   }`,
        order: sql`c.claim_date DESC`,
        limit,
      }),
    );
  }

  if (want.has("stockRequest")) {
    branches.push(
      branch({
        kind: "stockRequest",
        from: sql`stock_requests r`,
        id: sql`r.id::text`,
        title: sql`r.request_number`,
        subtitle: sql`r.requester_name_at_request`,
        status: sql`r.status::text`,
        amount: sql`r.total_value::text`,
        meta: sql`r.requester_department::text`,
        rank: sql`CASE WHEN r.request_number ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`r.request_number ILIKE ${any}
                   OR r.requester_name_at_request ILIKE ${any}
                   OR r.customer_name_at_request ILIKE ${any}`,
        order: sql`r.requested_at DESC`,
        limit,
      }),
    );
  }

  if (want.has("project")) {
    branches.push(
      branch({
        kind: "project",
        from: sql`projects pr`,
        id: sql`pr.id::text`,
        title: sql`pr.project_number`,
        subtitle: sql`pr.name`,
        status: sql`pr.status::text`,
        meta: sql`pr.client_name`,
        rank: sql`CASE WHEN pr.project_number ILIKE ${starts} THEN 0 ELSE 1 END`,
        where: sql`pr.project_number ILIKE ${any}
                   OR pr.name ILIKE ${any}
                   OR pr.client_name ILIKE ${any}
                   OR pr.project_manager_name ILIKE ${any}`,
        order: sql`pr.created_at DESC`,
        limit,
      }),
    );
  }

  // Every section gated off. Returning early matters: a UNION of no branches
  // is a syntax error, not an empty result.
  if (branches.length === 0) return [];

  // The outer ORDER BY is not decoration. A branch's own ORDER BY exists to
  // decide WHICH four rows survive its LIMIT; it does not constrain the order
  // the UNION emits them in, and Postgres is free to interleave. The caller
  // groups by kind, so only the order WITHIN a kind matters — and that is what
  // `rank` carries.
  const rows = (await tx.execute(sql`
    SELECT kind, id, title, subtitle, status, amount, meta
      FROM (${sql.join(branches, sql` UNION ALL `)}) AS hits
     ORDER BY kind, rank
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    kind: r.kind as SearchKind,
    id: String(r.id),
    title: (r.title as string) ?? null,
    subtitle: (r.subtitle as string) ?? null,
    status: (r.status as string) ?? null,
    amount: (r.amount as string) ?? null,
    meta: (r.meta as string) ?? null,
  }));
}
