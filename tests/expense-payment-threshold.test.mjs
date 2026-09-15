/**
 * Expense payment approval threshold.
 *
 * Finance staff (Accountant/Manager) may release a small expense payment
 * directly; above the configurable threshold the release is routed for sign-off
 * (CFO/Finance Manager/Admin) — segregation of duties. This isolates the GATE
 * decision: who routes for approval vs. who pays through.
 *
 * POSTGRES since 0059. The gate itself did not change, but two things around
 * it did, and both are asserted below:
 *
 *   - the amount is read from the Postgres row's `total`, a GENERATED column,
 *     rather than from a Mongo field that a write could leave stale;
 *   - releasing an APPROVED payment goes through a separate action that does
 *     NOT re-check the threshold. Re-checking it would refuse the payment for
 *     needing the approval it has just been given.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Threshold pinned; submitApproval mocked so we observe routing without its
// internals. The thresholds themselves have been Postgres since 0035 and are
// now read straight from `@/app/db/companyConfig` — the Mongo-path module that
// used to forward the call was a detour, not a store. Approvals remain their
// own unported module, and that seam is the point of the dynamic imports.
vi.mock("@/app/db/companyConfig", () => ({
  getCompanyThresholds: vi.fn(async () => ({ expensePaymentValue: 50_000 })),
}));
const submitApproval = vi.fn(async () => ({
  success: true,
  approval: { _id: "appr1", requestNumber: "APR-0001" },
}));
// POSTGRES since 0101, and this mock was left pointing at the Mongo module
// when the engine moved — so the real submitApproval ran against the stubbed
// `{}` transaction and every routing assertion in this file failed with
// "tx.execute is not a function". Repointed with the 0102 sweep.
vi.mock("@/app/db/actions/approval-actions", () => ({
  submitApproval: (...a) => submitApproval(...a),
}));

// The tenant layer is stubbed so the gate is what is under test, not RLS —
// that is covered by tests/pg-expenses.test.mjs.
const ctx = { role: "Accountant", expense: null };
vi.mock("@/app/db/tenant", () => ({
  withAuthorizedTenant: vi.fn(async (_roles, fn) =>
    fn({}, { user: { id: "u1", name: "Acc", role: ctx.role }, companyId: "c1" }),
  ),
}));

const recordPayment = vi.fn(async () => ({
  expense: {
    id: ctx.expense.id,
    expenseNumber: ctx.expense.expenseNumber,
    projectId: null,
    total: ctx.expense.total,
  },
}));
vi.mock("@/app/db/repositories/expenses", () => ({
  getExpense: vi.fn(async () => ctx.expense),
  recordExpensePayment: (...a) => recordPayment(...a),
}));

const { recordExpensePaymentPg, applyApprovedExpensePaymentPg } = await import(
  "@/app/db/actions/expense-actions"
);

const ACCOUNT = "11111111-2222-3333-4444-555555555555";

function seedExpense(total) {
  ctx.expense = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    companyId: "c1",
    expenseNumber: "EXP-00001",
    // A string, because numeric(19,4) is a string in Drizzle — the gate has to
    // Number() it, and getting that wrong would compare "80000" to 50000 as
    // strings and route nothing.
    total: String(total),
    payeeNameAtExpense: "Mombasa Computers",
    paymentStatus: "unpaid",
    status: "posted",
  };
  return ctx.expense;
}

function payForm() {
  const fd = new FormData();
  fd.set("paymentMethod", "bank_transfer");
  fd.set("paidFrom", ACCOUNT);
  return fd;
}

describe("expense payment threshold gate", () => {
  beforeEach(() => {
    ctx.role = "Accountant";
    submitApproval.mockClear();
    recordPayment.mockClear();
  });

  it("routes an over-threshold payment for approval (Accountant can't release it)", async () => {
    const e = seedExpense(80_000); // > 50,000

    const res = await recordExpensePaymentPg(e.id, null, payForm());

    expect(submitApproval).toHaveBeenCalledTimes(1);
    expect(submitApproval.mock.calls[0][0].type).toBe("expense_payment");
    expect(submitApproval.mock.calls[0][0].payload.expenseId).toBe(e.id);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approval threshold/i);
    expect(res.pendingApprovalNumber).toBe("APR-0001");

    // Nothing was released.
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("does NOT route a payment at/below the threshold", async () => {
    const e = seedExpense(30_000); // <= 50,000

    const res = await recordExpensePaymentPg(e.id, null, payForm());

    expect(submitApproval).not.toHaveBeenCalled();
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it("lets a bypass role (CFO) release any amount without approval", async () => {
    ctx.role = "CFO";
    const e = seedExpense(200_000); // huge, but CFO bypasses

    await recordExpensePaymentPg(e.id, null, payForm());

    expect(submitApproval).not.toHaveBeenCalled();
    expect(recordPayment).toHaveBeenCalledTimes(1);
  });

  it("releases an approved payment WITHOUT re-checking the threshold", async () => {
    // The approval engine calls this after sign-off. Running the gate again
    // here would refuse the payment on the grounds that it needs the approval
    // it has just received.
    const e = seedExpense(200_000);

    const res = await applyApprovedExpensePaymentPg(e.id, {
      paymentMethod: "bank_transfer",
      paidFrom: ACCOUNT,
      paidAt: null,
    });

    expect(submitApproval).not.toHaveBeenCalled();
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    // The approval engine still has to move a MONGO project's committed cost,
    // and takes the amount from the Postgres row rather than guessing.
    expect(res.total).toBe("200000");
  });

  it("refuses a payment account that is not a uuid", async () => {
    seedExpense(1_000);
    const fd = new FormData();
    fd.set("paymentMethod", "bank_transfer");
    fd.set("paidFrom", "507f1f77bcf86cd799439011"); // a Mongo ObjectId

    const res = await recordExpensePaymentPg(ctx.expense.id, null, fd);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not a valid payment account/i);
    expect(recordPayment).not.toHaveBeenCalled();
  });
});
