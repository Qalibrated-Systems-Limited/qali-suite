/**
 * Project financials — reversal netting + rebuild.
 *
 * The bug class: a project's cached cost/revenue counters were maintained by
 * scattered $inc calls and never reversed when a credit note was issued or a
 * bill cancelled — so project revenue/cost overstated, permanently, with no
 * way to repair. The fix makes computeProjectActuals the single source of
 * truth (it nets credit notes and excludes cancelled bills) and
 * recomputeProjectFinancials rebuilds the counters from it.
 *
 * This drives the real recompute against the in-memory DB. Docs are inserted
 * at the collection level (only the fields the aggregation reads) so the test
 * targets the financial logic, not every model's full validation surface.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Project from "@/app/models/project";
import "@/app/models/invoice";
import "@/app/models/creditNote";
import "@/app/models/bill";
import "@/app/models/expenses";
import "@/app/models/employeesClaims";
import "@/app/models/requests";
import "@/app/models/stockmovement";

// Same Next/request-glue mocks the other action tests use. computeProjectActuals
// takes (pid, tenantMatch) directly, so no tenant-context mock behaviour is
// needed — the module just has to load.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({})),
  withTenantScope: (q) => q,
  getCompanyIdForCreate: (_e, u) => u,
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { recomputeProjectFinancials } = await import(
  "@/app/mongodb/actions/project-actions.js"
);

const { ObjectId } = mongoose.Types;

// Models carry a unique (companyId, <doc>Number) index. Raw collection inserts
// bypass Mongoose, so stamp a unique number here or the second doc collides on
// a null key (which is exactly what slipped past local runs but failed in CI,
// where the index was already built).
let seq = 0;
const NUMBER_FIELD = {
  Invoice: "invoiceNumber",
  CreditNote: "creditNoteNumber",
  Bill: "billNumber",
  StockMovement: "movementNumber",
};

async function rawInsert(model, docs) {
  if (!docs.length) return;
  const field = NUMBER_FIELD[model];
  const stamped = docs.map((d) =>
    field && d[field] == null ? { ...d, [field]: `${field}-${++seq}` } : d,
  );
  await mongoose.model(model).collection.insertMany(stamped);
}

describe("recomputeProjectFinancials", () => {
  let companyId, projectId;

  // Build the unique indexes up front so local runs reproduce CI (where the
  // index is already built) — otherwise a duplicate-key bug only shows in CI.
  beforeAll(async () => {
    await Promise.all([
      mongoose.model("Invoice").init(),
      mongoose.model("CreditNote").init(),
      mongoose.model("Bill").init(),
      mongoose.model("StockMovement").init(),
    ]);
  });

  beforeEach(async () => {
    companyId = new ObjectId();
    projectId = new ObjectId();
    await Project.create({
      _id: projectId,
      companyId,
      name: "Otho Got Kachulo Road",
      projectNumber: `PRJ-${Date.now()}`,
      status: "active",
    });
  });

  it("nets issued credit notes from project revenue and excludes cancelled bills", async () => {
    const inv1 = new ObjectId();
    const inv2 = new ObjectId();
    await rawInsert("Invoice", [
      { _id: inv1, companyId, projectId, status: "completed", total: 1000, items: [] },
      { _id: inv2, companyId, projectId, status: "completed", total: 1000, items: [] },
    ]);
    // A KES 300 credit note issued against invoice 1 → reverses revenue.
    await rawInsert("CreditNote", [
      { companyId, invoice: { id: inv1 }, status: "issued", total: 300 },
      // a draft credit note must NOT count
      { companyId, invoice: { id: inv2 }, status: "draft", total: 500 },
    ]);
    await rawInsert("Bill", [
      // real cost
      { companyId, projectId, status: "approved", paymentStatus: "paid", amounts: { netPayable: 500 } },
      // paid then CANCELLED — must be excluded
      { companyId, projectId, status: "cancelled", paymentStatus: "paid", amounts: { netPayable: 999 } },
    ]);

    const actuals = await recomputeProjectFinancials(projectId.toString());

    expect(actuals.revenue).toBe(1700); // 2000 invoiced − 300 credited
    expect(actuals.costs).toBe(500); // cancelled bill excluded

    const project = await Project.findById(projectId).lean();
    expect(project.financials.totalRevenue).toBe(1700);
    expect(project.financials.totalCosts).toBe(500);
  });

  it("nets returned COGS from cost when a credit note restores inventory", async () => {
    const inv1 = new ObjectId();
    await rawInsert("Invoice", [
      {
        _id: inv1,
        companyId,
        projectId,
        status: "completed",
        total: 2000,
        // a direct-store product line whose COGS counts toward project cost
        items: [
          {
            itemType: "product",
            costing: { totalCost: 800 },
          },
        ],
      },
    ]);
    // Goods worth 300 of COGS returned via a restoreInventory credit note →
    // a posted "return" movement against the invoice.
    await rawInsert("StockMovement", [
      {
        companyId,
        movementType: "return",
        status: "posted",
        relatedDocuments: { invoiceId: inv1 },
        costing: { totalCost: 300 },
      },
    ]);

    const actuals = await recomputeProjectFinancials(projectId.toString());
    expect(actuals.costs).toBe(500); // 800 COGS − 300 returned
  });

  it("repairs drifted counters (rebuild from source, not increment)", async () => {
    await rawInsert("Invoice", [
      { _id: new ObjectId(), companyId, projectId, status: "completed", total: 800, items: [] },
    ]);
    // Simulate drift: counters were left wildly wrong by a missed reversal.
    await Project.findByIdAndUpdate(projectId, {
      $set: {
        "financials.totalRevenue": 999999,
        "financials.totalCosts": 4242,
      },
    });

    await recomputeProjectFinancials(projectId.toString());

    const project = await Project.findById(projectId).lean();
    expect(project.financials.totalRevenue).toBe(800); // rebuilt, not incremented
    expect(project.financials.totalCosts).toBe(0);
    expect(project.financials.totalCommitted).toBe(0);
  });
});
