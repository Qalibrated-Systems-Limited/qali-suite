"use server";

import { withAuthorizedTenant } from "../tenant";
import * as search from "../repositories/globalSearch";
import type { SearchHit, SearchKind } from "../repositories/globalSearch";
import {
  canSeeInventoryNav,
  canSeeSalesNav,
  canSeeFinanceNav,
  canSeeProjectsNav,
  canReviewClaims,
} from "@/lib/permissions";

/**
 * The command palette's server search.
 *
 * WHAT THIS REPLACES. `app/mongodb/actions/global-search-action.js`, which read
 * the Mongo `Product`, `Invoice`, `Quote`, `Bill`, `Party`, `StockRequest` and
 * `Project` models. Every one of those collections has moved. Only claims was
 * repointed — by whoever ported claims, who hit it — so Ctrl-K has been
 * offering navigation entries and one working section since products ported.
 *
 * It never errored, and that is the whole reason it lasted: an empty result set
 * looks exactly like a search with no matches. Neither the module count in
 * BUILDING-ON-POSTGRES.md nor `ledger-sweep` could see it — it imports the
 * MODELS rather than `@/app/mongodb`, and it posts nothing.
 *
 * TWO THINGS ARE DELIBERATELY NOT WHAT MONGO DID.
 *
 * 1. RESULTS ARE GATED BY ROLE. The Mongo version returned invoices, bills,
 *    claims, projects and every customer's contact details to anyone who could
 *    open the palette, including a Storekeeper. The palette already refuses to
 *    OFFER a page the role cannot see — "the app should not offer a door it
 *    will refuse to open", per the comment on its plan gate — and search
 *    results are the same claim about the same doors. The gates below are the
 *    ones `components/sidebar-content-grouped.jsx` puts on the matching nav
 *    item, read off it rather than guessed: parties sit behind FINANCE there,
 *    not sales, which is not what I would have assumed.
 *
 * 2. CLAIMS ARE SCOPED TO THE READER unless they review claims. The Mongo
 *    search — and `searchClaimsPg` after it — matched every claim in the
 *    company, so any employee could type a colleague's name and read their
 *    reimbursements and amounts. Gating claims OFF for non-reviewers would fix
 *    the leak and take away an employee's ability to find their own; scoping to
 *    `employee_user_id` does both properly.
 *
 * Cost: one round trip. See the note on the UNION in globalSearch.ts for why
 * this does not call the eight modules' own `search*` functions.
 */

/** What the palette shows per section. */
const LIMIT = 4;

/** The empty shape, so the client can destructure without guarding. */
const EMPTY = {
  products: [],
  invoices: [],
  quotes: [],
  bills: [],
  customers: [],
  suppliers: [],
  claims: [],
  stockRequests: [],
  projects: [],
};

/**
 * Which sections this role may search, mirroring the sidebar's `hidden:` flags.
 *
 * Bills carry the sidebar's own exception verbatim — Procurement Officer is not
 * in the finance nav list but the Bills item is shown to them explicitly.
 */
function visibleKinds(role: string | undefined): SearchKind[] {
  const kinds: SearchKind[] = [];
  if (canSeeInventoryNav(role)) kinds.push("product", "stockRequest");
  if (canSeeSalesNav(role)) kinds.push("invoice", "quote");
  if (canSeeFinanceNav(role) || role === "Procurement Officer") kinds.push("bill");
  if (canSeeFinanceNav(role)) kinds.push("customer", "supplier");
  if (canSeeProjectsNav(role)) kinds.push("project");
  // Everyone may find a claim; WHOSE claims is decided below.
  kinds.push("claim");
  return kinds;
}

const money = (v: string | null) => (v === null ? null : Number(v));

/**
 * Back into the nine nested arrays the palette destructures.
 *
 * The client component is untouched by this port, so the shapes below are
 * `_id`, `customer.name`, `amounts.total` and the rest exactly as the Mongo
 * documents came out. A flat row is the better interface and changing the
 * palette to take one is a separate change from making it return data at all.
 */
function group(hits: SearchHit[]) {
  const of = (kind: SearchKind) => hits.filter((h) => h.kind === kind);

  return {
    products: of("product").map((h) => ({
      _id: h.id,
      name: h.title,
      SKU: h.subtitle,
      inventory: { quantityOnHand: money(h.meta) ?? 0 },
    })),
    invoices: of("invoice").map((h) => ({
      _id: h.id,
      invoiceNumber: h.title,
      customer: { name: h.subtitle },
      status: h.status,
      total: money(h.amount),
    })),
    quotes: of("quote").map((h) => ({
      _id: h.id,
      quoteNumber: h.title,
      customer: { name: h.subtitle },
      status: h.status,
      total: money(h.amount),
    })),
    bills: of("bill").map((h) => ({
      _id: h.id,
      billNumber: h.title,
      supplier: { name: h.subtitle },
      status: h.status,
      amounts: { total: money(h.amount) },
    })),
    customers: of("customer").map((h) => ({
      _id: h.id,
      displayName: h.title,
      name: h.title,
      email: h.subtitle,
    })),
    suppliers: of("supplier").map((h) => ({
      _id: h.id,
      displayName: h.title,
      name: h.title,
      email: h.subtitle,
    })),
    claims: of("claim").map((h) => ({
      _id: h.id,
      claimNumber: h.title,
      employee: { name: h.subtitle },
      claimType: h.meta,
      status: h.status,
      totalAmount: money(h.amount),
    })),
    stockRequests: of("stockRequest").map((h) => ({
      _id: h.id,
      requestNumber: h.title,
      requester: { name: h.subtitle, department: h.meta },
      status: h.status,
    })),
    projects: of("project").map((h) => ({
      _id: h.id,
      projectNumber: h.title,
      name: h.subtitle,
      status: h.status,
      client: { name: h.meta },
    })),
  };
}

export async function globalSearch(searchTerm: string) {
  if (!searchTerm || searchTerm.trim().length < 2) return EMPTY;

  try {
    return await withAuthorizedTenant([], async (tx, { user }) => {
      const role = user.role;
      const hits = await search.globalSearch(tx, searchTerm, {
        kinds: visibleKinds(role),
        limit: LIMIT,
        // Reviewers see the company's claims; everybody else sees their own.
        ownClaimsUserId: canReviewClaims(role) ? null : user.id,
      });
      return group(hits);
    });
  } catch (err) {
    // A palette that throws closes over the user's typing. It returns nothing
    // and logs instead — the same call `searchClaimsPg` made, for the same
    // reason.
    console.error("[globalSearch]", err);
    return EMPTY;
  }
}
