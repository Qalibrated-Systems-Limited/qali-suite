/**
 * createQuote server-action integration test.
 *
 * Why this exists: the financial *model* tests (invoices/bills/...) exercise
 * schema methods directly and never touch the server-action layer. A
 * regression where `formatAddress` wasn't imported into the action shipped
 * green because nothing invoked createQuote end-to-end — it crashed only at
 * runtime, in prod, on the quote/bill/PO/credit-note create screens.
 *
 * This test drives the real createQuote action against an in-memory replica
 * set, mocking only the Next.js request-scoped glue (auth/tenant context,
 * redirect, revalidate, email). It asserts two things:
 *   1. The action runs to completion (redirects) — i.e. no undefined-ref /
 *      ReferenceError on the way (the formatAddress class of bug).
 *   2. The address snapshot is collapsed to a clean one-line string even when
 *      the customer's address arrives as an object or a stringified object —
 *      the exact shapes that leaked "{ country: 'Kenya' }" to the UI.
 *
 * The static guarantee that formatAddress is imported now lives in CI lint
 * (no-undef); this is the behavioural counterpart.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";
import Quote from "@/app/models/quote";
import "@/app/models/erp-counter"; // registers "ErpCounter" for generateQuoteNumber
import { seedTenant } from "./helpers/fixtures.mjs";

// ── Request-scoped Next glue: mock only what the action needs to run ──
// Tenant context is normally derived from the session; pin it per-test via
// this mutable holder so each test can set its own company/user.
const ctx = { companyId: null, isSuperAdmin: false, user: null };

// Fully mock tenant-utils with self-contained implementations. We avoid
// importOriginal here because the real module imports `@/auth` (next-auth),
// which transitively pulls in `next/server` and won't resolve under plain
// Node. These four reimplementations mirror the real contract closely enough
// for the action: tenant scoping by companyId, SuperAdmin bypass.
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({
    companyId: ctx.companyId,
    isSuperAdmin: ctx.isSuperAdmin,
    user: ctx.user,
  })),
  getCompanyIdForCreate: (explicit, userCompanyId, isSuperAdmin) => {
    if (explicit) return explicit;
    if (isSuperAdmin) throw new Error("SuperAdmin must specify companyId");
    if (!userCompanyId) throw new Error("User must have companyId");
    return userCompanyId;
  },
  withTenantScope: (query, companyId, isSuperAdmin) => {
    if (isSuperAdmin) return query;
    return { ...query, companyId: new mongoose.Types.ObjectId(companyId) };
  },
  buildTenantMatch: (companyId) => ({
    companyId: new mongoose.Types.ObjectId(companyId),
  }),
}));

// dbConnect is a no-op here — the test harness already holds an open Mongoose
// connection to the in-memory replica set.
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a) => redirect(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (cb) => cb?.() }));
vi.mock("@/lib/email", () => ({ sendQuoteEmail: vi.fn(async () => {}) }));

// Imported after the mocks are declared (vi.mock is hoisted regardless).
const { createQuote } = await import("@/app/mongodb/actions/quote-actions.js");

// Build a FormData whose single "data" field is the JSON the action parses.
function quoteFormData(data) {
  const fd = new FormData();
  fd.set("data", JSON.stringify(data));
  return fd;
}

const baseItems = [
  {
    itemType: "service",
    serviceCategory: "consultation",
    description: "Advisory hours",
    quantity: 2,
    unitPrice: 100,
    taxRate: 0,
  },
];

describe("createQuote server action", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("persists a quote and redirects when address is a plain object", async () => {
    const tenant = await seedTenant();
    ctx.companyId = tenant.company._id.toString();
    ctx.isSuperAdmin = false;
    ctx.user = { name: tenant.user.name, id: tenant.user._id.toString() };

    const result = await createQuote(
      null,
      quoteFormData({
        customer: {
          id: "cust-1",
          name: "Kisumu Yard",
          email: "yard@test.co",
          phone: "0706684567",
          // The bug shape: an address OBJECT, not a string.
          address: { city: "Kisumu", country: "Kenya" },
        },
        items: baseItems,
      }),
    );

    // No error object returned ⇒ the action reached redirect() (success).
    // If formatAddress were undefined, the catch would return { success:false }.
    expect(result?.success).not.toBe(false);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect.mock.calls[0][0]).toMatch(/\/dashboard\/quotes\//);

    const quote = await Quote.findOne({ companyId: tenant.company._id });
    expect(quote).toBeTruthy();
    // Snapshot is a clean string, never the raw object.
    expect(typeof quote.customer.address).toBe("string");
    expect(quote.customer.address).toBe("Kisumu, Kenya");
  });

  it("collapses a stringified-object address (the prod leak shape)", async () => {
    const tenant = await seedTenant();
    ctx.companyId = tenant.company._id.toString();
    ctx.isSuperAdmin = false;
    ctx.user = { name: tenant.user.name, id: tenant.user._id.toString() };

    const result = await createQuote(
      null,
      quoteFormData({
        customer: {
          id: "cust-2",
          name: "Stringified Co",
          email: "s@test.co",
          // The literal that leaked to screens before the fix.
          address: "{ country: 'Kenya' }",
        },
        items: baseItems,
      }),
    );

    expect(result?.success).not.toBe(false);
    expect(redirect).toHaveBeenCalledTimes(1);

    const quote = await Quote.findOne({ companyId: tenant.company._id });
    expect(quote.customer.address).toBe("Kenya");
  });

  it("returns a validation error (not a crash) when customer is missing", async () => {
    const tenant = await seedTenant();
    ctx.companyId = tenant.company._id.toString();
    ctx.isSuperAdmin = false;
    ctx.user = { name: tenant.user.name, id: tenant.user._id.toString() };

    const result = await createQuote(
      null,
      quoteFormData({ items: baseItems }),
    );

    expect(result?.success).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });
});
