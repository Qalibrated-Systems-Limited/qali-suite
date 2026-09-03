/**
 * Bill payment approval threshold.
 *
 * Finance staff may record a small supplier payment directly; above the
 * configured threshold it is routed for sign-off (CFO / Finance Manager /
 * Admin) — segregation of duties on the larger ones. This isolates the GATE
 * decision, the way tests/expense-payment-threshold.test.mjs does for expenses.
 *
 * POSTGRES, and the gate MOVED while porting. Three things changed, and each
 * is asserted below:
 *
 *   - WHERE IT SITS. Mongo created a draft payment and checked the threshold
 *     at CONFIRM, so an over-threshold payment existed, allocated, while it
 *     waited. On this schema allocations drive `invoices.amount_paid` and
 *     `bills.balance` by trigger, so that draft would have shown a bill as
 *     paid from a payment the ledger had never seen. The check now happens
 *     before anything is written at all.
 *
 *   - WHAT THE APPROVAL CARRIES. With no row to point at, the approval holds
 *     the form's own fields as its payload, plus the payment id minted up
 *     front — so `targetRef.id` names the payment the release will create and
 *     the approval's link to it resolves.
 *
 *   - RELEASE DOES NOT RE-CHECK. Re-checking would refuse the payment for
 *     needing the approval it has just been given.
 *
 * INBOUND MONEY IS NOT GATED, and never was: receiving a large cheque is not a
 * control point. Mongo tests `isOutbound` and so does this.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Thresholds are Postgres (0035); the action reads them from companyConfig
// directly rather than through the retired Mongo-path forwarder.
vi.mock("@/app/db/companyConfig", () => ({
  getCompanyThresholds: vi.fn(async () => ({ billPaymentValue: 100_000 })),
}));

const submitApproval = vi.fn(async () => ({
  success: true,
  approval: { _id: "appr1", requestNumber: "APR-0001" },
}));
vi.mock("@/app/mongodb/actions/approval-actions", () => ({
  submitApproval: (...a) => submitApproval(...a),
}));

// The tenant layer is stubbed so the GATE is what is under test, not RLS —
// that is tests/pg-payment-actions.test.mjs.
const ctx = { role: "Accountant" };
vi.mock("@/app/db/tenant", () => ({
  withAuthorizedTenant: vi.fn(async (_roles, fn) =>
    fn(
      {},
      { user: { id: "u1", name: "Acc", role: ctx.role }, companyId: "c1" },
    ),
  ),
}));

vi.mock("@/app/db/repositories/parties", () => ({
  getParty: vi.fn(async () => ({ id: "p1", name: "Tosha Ltd" })),
}));

// Everything below the gate. If the gate holds a payment, NONE of these run —
// which is the assertion that nothing was written.
const createPayment = vi.fn(async (_tx, input) => ({
  id: input.id,
  paymentNumber: "PMT-0001",
  paymentType: input.paymentType,
}));
const allocateToBill = vi.fn(async () => ({}));
const confirmPayment = vi.fn(async () => ({}));
const postPaymentMade = vi.fn(async () => ({ entryNumber: "JE-0001" }));
const postPaymentReceipt = vi.fn(async () => ({ entryNumber: "JE-0002" }));
vi.mock("@/app/db/repositories/payments", () => ({
  createPayment: (...a) => createPayment(...a),
  allocateToBill: (...a) => allocateToBill(...a),
  allocateToInvoice: vi.fn(async () => ({})),
  confirmPayment: (...a) => confirmPayment(...a),
  postPaymentMade: (...a) => postPaymentMade(...a),
  postPaymentReceipt: (...a) => postPaymentReceipt(...a),
}));

vi.mock("@/app/db/repositories/accounts", () => ({
  getSystemAccount: vi.fn(async (_tx, key) =>
    key === "undeposited_funds" ? null : { id: "acct-control" },
  ),
  listPaymentAccounts: vi.fn(async () => []),
}));

const { createPaymentPg, releaseApprovedPaymentPg } = await import(
  "@/app/db/actions/payment-actions"
);

const PARTY = "11111111-2222-3333-4444-555555555555";
const ACCOUNT = "66666666-7777-8888-9999-aaaaaaaaaaaa";

const form = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.set(k, String(v));
  }
  return fd;
};

const made = (amount, over = {}) =>
  form({
    paymentType: "made",
    amount,
    partyId: PARTY,
    accountId: ACCOUNT,
    paymentDate: "2026-03-10",
    paymentMethod: "bank_transfer",
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  ctx.role = "Accountant";
});

describe("bill payment approval threshold", () => {
  it("pays through below the threshold", async () => {
    const res = await createPaymentPg(null, made(99_999));

    expect(res.success).toBe(true);
    expect(submitApproval).not.toHaveBeenCalled();
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(postPaymentMade).toHaveBeenCalledTimes(1);
  });

  it("routes for sign-off above it — and writes NOTHING", async () => {
    const res = await createPaymentPg(null, made(150_000));

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceeds the KES 100,000 approval threshold/);
    expect(res.error).toMatch(/APR-0001/);
    expect(submitApproval).toHaveBeenCalledTimes(1);

    // The whole point of moving the check ahead of the write. A draft payment
    // here would have settled the bill by trigger while the ledger stayed empty.
    expect(createPayment).not.toHaveBeenCalled();
    expect(allocateToBill).not.toHaveBeenCalled();
    expect(postPaymentMade).not.toHaveBeenCalled();
  });

  it("holds the payment id and the form's fields on the approval", async () => {
    await createPaymentPg(
      null,
      made(150_000, {
        reference: "CHQ-771",
        allocations: JSON.stringify([
          { documentId: "bill-1", amountAllocated: "150000" },
        ]),
      }),
    );

    const [arg] = submitApproval.mock.calls[0];
    expect(arg.type).toBe("bill_payment");
    expect(arg.targetRef.kind).toBe("Payment");
    // A UUID, not an ObjectId — which is why approvalRequest.targetRef.id had
    // to stop being one. It is also the id the release will create.
    expect(arg.targetRef.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(arg.targetRef.label).toContain("Tosha Ltd");
    expect(arg.payload.paymentId).toBe(arg.targetRef.id);
    expect(arg.payload.reference).toBe("CHQ-771");
    expect(arg.payload.amount).toBe("150000");
    expect(arg.payload.allocations).toContain("bill-1");
    expect(arg.context).toEqual({ amount: 150_000, threshold: 100_000 });
  });

  it("lets an approver pay through without raising an approval on themselves", async () => {
    ctx.role = "CFO";
    const res = await createPaymentPg(null, made(150_000));

    expect(res.success).toBe(true);
    expect(submitApproval).not.toHaveBeenCalled();
    expect(postPaymentMade).toHaveBeenCalledTimes(1);
  });

  it("does not gate money RECEIVED, however large", async () => {
    const res = await createPaymentPg(
      null,
      made(5_000_000, { paymentType: "received" }),
    );

    expect(res.success).toBe(true);
    expect(submitApproval).not.toHaveBeenCalled();
    expect(postPaymentReceipt).toHaveBeenCalledTimes(1);
  });

  it("releases an approved payment WITHOUT re-checking the threshold", async () => {
    await createPaymentPg(null, made(150_000));
    const { payload } = submitApproval.mock.calls[0][0];
    vi.clearAllMocks();

    const res = await releaseApprovedPaymentPg(payload);

    expect(res.success).toBe(true);
    // The threshold is what raised the approval; consulting it again would
    // refuse the payment for needing the sign-off it has just received.
    expect(submitApproval).not.toHaveBeenCalled();
    expect(postPaymentMade).toHaveBeenCalledTimes(1);
  });

  it("creates the released payment with the id the approval named", async () => {
    await createPaymentPg(null, made(150_000));
    const { payload, targetRef } = submitApproval.mock.calls[0][0];
    vi.clearAllMocks();

    await releaseApprovedPaymentPg(payload);

    // Otherwise the approval's link to /dashboard/payments/:id 404s, which is
    // the whole reason the id is minted before the row.
    expect(createPayment.mock.calls[0][1].id).toBe(targetRef.id);
  });

  it("reports a failure to raise the approval rather than paying anyway", async () => {
    submitApproval.mockResolvedValueOnce({ success: false, error: "queue down" });

    const res = await createPaymentPg(null, made(150_000));

    expect(res.success).toBe(false);
    expect(res.error).toBe("queue down");
    // A financial control that fails open is worse than one that fails.
    expect(createPayment).not.toHaveBeenCalled();
  });
});
