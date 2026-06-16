/**
 * Sales-order stock reservation chain.
 *
 * The money-critical invariant: confirming a sales order commits stock with
 * the SAME atomic conditional update draft invoices use ($gte guard), so it
 * is impossible to confirm more units than are available — even when two
 * confirmations race for the last units. Getting this wrong oversells
 * inventory: you promise stock you don't have, then can't fulfil.
 *
 * Covered:
 *   - confirm commits: quantityCommitted up, quantityAvailable down
 *   - oversell rejected: confirm fails, product untouched, order stays draft
 *   - cancel releases: the held commitment is returned to available
 *   - CONCURRENCY: two orders racing for the last units — exactly one wins,
 *     the loser is rejected, and the product counters never go negative
 *
 * Drives the real confirmSalesOrder / cancelSalesOrder server actions against
 * the in-memory replica set (transactions need a replica set — see
 * tests/setup.global.mjs). Only the Next request glue is mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import SalesOrder from "@/app/models/salesOrder";
import Product from "@/app/models/product";
import "@/app/models/erp-counter";
import { seedTenant } from "./helpers/fixtures.mjs";

const ctx = { companyId: null, isSuperAdmin: false, user: null };

vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({ ...ctx })),
  withTenantScope: (query, companyId, isSuperAdmin) =>
    isSuperAdmin
      ? query
      : { ...query, companyId: new mongoose.Types.ObjectId(companyId) },
  tenantFilter: (companyId, isSuperAdmin) =>
    isSuperAdmin ? {} : { companyId },
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Not exercised here (conversion path); stub to avoid its import chain.
vi.mock("@/app/mongodb/queries/invoice-queries", () => ({
  generateInvoiceNumber: vi.fn(async () => "INV-0001"),
}));

const { confirmSalesOrder, cancelSalesOrder } = await import(
  "@/app/mongodb/actions/sales-order-actions.js"
);

let seq = 0;
async function seedProduct(companyId, onHand) {
  return Product.create({
    companyId,
    name: `Widget ${seq}`,
    SKU: `SKU-${Date.now()}-${seq++}`,
    type: "product",
    category: "general",
    unit: "pcs",
    costing: { costPrice: 10 },
    inventory: {
      quantityOnHand: onHand,
      quantityCommitted: 0,
      quantityOnHold: 0,
      quantityAvailable: onHand,
    },
  });
}

async function seedDraftOrder(tenant, product, quantity) {
  return SalesOrder.create({
    companyId: tenant.company._id,
    orderNumber: `SO-${Date.now()}-${seq++}`,
    orderDate: new Date(),
    customer: { name: tenant.customer.name },
    items: [
      {
        lineNumber: 1,
        itemType: "product",
        product: { id: product._id, sku: product.SKU, name: product.name },
        description: product.name,
        quantity,
        unitPrice: 50,
        amount: quantity * 50,
        lineTotal: quantity * 50,
        stockCommitted: false,
      },
    ],
    subtotal: quantity * 50,
    total: quantity * 50,
    status: "draft",
    createdBy: { name: "Seed", id: "seed" },
  });
}

async function reload(productId) {
  return Product.findById(productId).lean();
}

describe("sales order reservation chain", () => {
  let tenant;

  // Pre-create the collections the confirm/cancel transactions touch. Without
  // this, the very first multi-document transaction against a brand-new
  // collection trips a "catalog changes" WriteConflict (a mongodb-memory-
  // server cold-start quirk, not a logic bug). Creating them up front stabilises
  // the catalog before any transaction runs.
  beforeAll(async () => {
    // init() creates the collection AND awaits index builds — both are
    // catalog changes that would otherwise fire inside the first transaction.
    await Promise.all([Product.init(), SalesOrder.init()]);
  });

  beforeEach(async () => {
    tenant = await seedTenant();
    ctx.companyId = tenant.company._id.toString();
    ctx.isSuperAdmin = false;
    ctx.user = {
      name: tenant.user.name,
      id: tenant.user._id.toString(),
      role: "Admin",
    };
  });

  it("commits stock on confirm", async () => {
    const product = await seedProduct(tenant.company._id, 10);
    const so = await seedDraftOrder(tenant, product, 4);

    const res = await confirmSalesOrder(so._id.toString());
    expect(res.success).toBe(true);

    const p = await reload(product._id);
    expect(p.inventory.quantityCommitted).toBe(4);
    expect(p.inventory.quantityAvailable).toBe(6);

    const confirmed = await SalesOrder.findById(so._id).lean();
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.items[0].stockCommitted).toBe(true);
  });

  it("rejects an oversell and leaves the product + order untouched", async () => {
    const product = await seedProduct(tenant.company._id, 5);
    const so = await seedDraftOrder(tenant, product, 100);

    const res = await confirmSalesOrder(so._id.toString());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/insufficient stock/i);

    const p = await reload(product._id);
    expect(p.inventory.quantityCommitted).toBe(0);
    expect(p.inventory.quantityAvailable).toBe(5); // untouched

    const stillDraft = await SalesOrder.findById(so._id).lean();
    expect(stillDraft.status).toBe("draft");
  });

  it("releases the commitment on cancel", async () => {
    const product = await seedProduct(tenant.company._id, 10);
    const so = await seedDraftOrder(tenant, product, 4);

    expect((await confirmSalesOrder(so._id.toString())).success).toBe(true);
    const afterConfirm = await reload(product._id);
    expect(afterConfirm.inventory.quantityAvailable).toBe(6);

    const res = await cancelSalesOrder(so._id.toString(), "changed mind");
    expect(res.success).toBe(true);

    const afterCancel = await reload(product._id);
    expect(afterCancel.inventory.quantityCommitted).toBe(0);
    expect(afterCancel.inventory.quantityAvailable).toBe(10); // fully restored
  });

  it("never oversells when two orders race for the last units", async () => {
    // 10 on hand; two orders of 6 each. Their combined demand (12) exceeds
    // supply, so AT MOST one can win. The $gte guard must reject the other.
    const product = await seedProduct(tenant.company._id, 10);
    const soA = await seedDraftOrder(tenant, product, 6);
    const soB = await seedDraftOrder(tenant, product, 6);

    const [resA, resB] = await Promise.all([
      confirmSalesOrder(soA._id.toString()),
      confirmSalesOrder(soB._id.toString()),
    ]);

    const wins = [resA, resB].filter((r) => r.success).length;
    expect(wins).toBe(1); // exactly one — never both

    const p = await reload(product._id);
    // Only the winner's 6 are committed; counters stay non-negative.
    expect(p.inventory.quantityCommitted).toBe(6);
    expect(p.inventory.quantityAvailable).toBe(4);
    expect(p.inventory.quantityAvailable).toBeGreaterThanOrEqual(0);
  });
});
