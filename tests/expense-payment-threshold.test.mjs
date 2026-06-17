/**
 * Expense payment approval threshold.
 *
 * Finance staff (Accountant/Manager) may release a small expense payment
 * directly; above the configurable threshold the release is routed for sign-off
 * (CFO/Finance Manager/Admin) — segregation of duties. This isolates the GATE
 * decision: who routes for approval vs. who pays through.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import "@/app/models/expenses";

const { ObjectId } = mongoose.Types;
const ctx = { companyId: null, isSuperAdmin: false, user: null };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({ ...ctx })),
  withTenantScope: (q, companyId, isSuperAdmin) =>
    isSuperAdmin ? q : { ...q, companyId: new ObjectId(companyId) },
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// Threshold pinned; submitApproval mocked so we observe routing without its internals.
vi.mock("@/app/mongodb/queries/threshold-queries", () => ({
  getCompanyThresholds: vi.fn(async () => ({ expensePaymentValue: 50_000 })),
}));
const submitApproval = vi.fn(async () => ({
  success: true,
  approval: { _id: "appr1", requestNumber: "APR-0001" },
}));
vi.mock("@/app/mongodb/actions/approval-actions", () => ({ submitApproval: (...a) => submitApproval(...a) }));

const { recordExpensePayment } = await import(
  "@/app/mongodb/actions/expense-actions.js"
);

let companyId;
async function seedExpense(total) {
  const Expense = mongoose.model("Expense");
  const [e] = await Expense.collection.insertMany([
    {
      companyId,
      expenseNumber: `EXP-${Date.now()}-${Math.round(total)}`,
      status: "posted",
      paymentStatus: "unpaid",
      total,
      vendor: { name: "Mombasa Computers" },
    },
  ]).then((r) => Expense.find({ _id: { $in: Object.values(r.insertedIds) } }));
  return e._id;
}

function payForm() {
  const fd = new FormData();
  fd.set("paymentMethod", "bank_transfer");
  fd.set("paidFrom", new ObjectId().toString());
  return fd;
}

describe("expense payment threshold gate", () => {
  beforeEach(() => {
    companyId = new ObjectId();
    ctx.companyId = companyId.toString();
    ctx.isSuperAdmin = false;
    submitApproval.mockClear();
  });

  it("routes an over-threshold payment for approval (Accountant can't release it)", async () => {
    ctx.user = { name: "Acc", id: new ObjectId().toString(), role: "Accountant" };
    const id = await seedExpense(80_000); // > 50,000

    const res = await recordExpensePayment(id.toString(), null, payForm());

    expect(submitApproval).toHaveBeenCalledTimes(1);
    expect(submitApproval.mock.calls[0][0].type).toBe("expense_payment");
    expect(submitApproval.mock.calls[0][0].payload.expenseId).toBe(id.toString());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approval threshold/i);
    expect(res.pendingApprovalNumber).toBe("APR-0001");

    // still unpaid — nothing was released
    const e = await mongoose.model("Expense").findById(id).lean();
    expect(e.paymentStatus).toBe("unpaid");
  });

  it("does NOT route a payment at/below the threshold", async () => {
    ctx.user = { name: "Acc", id: new ObjectId().toString(), role: "Accountant" };
    const id = await seedExpense(30_000); // <= 50,000

    await recordExpensePayment(id.toString(), null, payForm());
    expect(submitApproval).not.toHaveBeenCalled(); // pays through the direct path
  });

  it("lets a bypass role (CFO) release any amount without approval", async () => {
    ctx.user = { name: "Boss", id: new ObjectId().toString(), role: "CFO" };
    const id = await seedExpense(200_000); // huge, but CFO bypasses

    await recordExpensePayment(id.toString(), null, payForm());
    expect(submitApproval).not.toHaveBeenCalled();
  });
});
