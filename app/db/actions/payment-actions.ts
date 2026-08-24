"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as paymentsRepo from "../repositories/payments";
import * as accountsRepo from "../repositories/accounts";
import * as partiesRepo from "../repositories/parties";

/**
 * Payments on Postgres.
 *
 * The repository has been complete since the payments port — createPayment,
 * allocateToInvoice, allocateToBill, postPaymentReceipt, postPaymentMade,
 * clearPaymentReceipt, confirmPayment — and `invoice-actions.ts` already uses
 * three of them, which is why receiving a payment AGAINST AN INVOICE has been
 * on Postgres all along. What had no action layer was the standalone payments
 * module, so `payment-actions.js:656` went on calling `payment.confirm()` and
 * posting into the Mongo ledger from five screens.
 *
 * CONFIRM AND POST ARE ONE STEP HERE. In the repository they are two —
 * `confirmPayment` flips the status, `postPaymentReceipt`/`postPaymentMade`
 * write the entry — and nothing enforced that the second followed the first.
 * A payment confirmed without posting is money the ledger never saw, so this
 * layer does both inside one transaction or neither.
 *
 *   received  DR Cash/Bank  CR Accounts Receivable
 *   made      DR Accounts Payable  CR Cash/Bank
 */

export type ActionResult =
  | { success: true; paymentId?: string; paymentNumber?: string; entryNumber?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not found") ||
    message.includes("not in draft") ||
    message.includes("already") ||
    message.includes("exceeds") ||
    message.includes("not configured") ||
    message.includes("permission") ||
    message.includes("greater than zero")
  ) {
    return { success: false, error: message };
  }
  return { success: false, error: userMessage(err, "Something went wrong with this payment.") };
}

/**
 * The control account a payment clears against, by direction.
 *
 * Resolved here rather than in the repository, which must not read
 * configuration — the same split completeInvoicePg uses.
 */
async function controlAccount(
  tx: Parameters<typeof accountsRepo.getSystemAccount>[0],
  paymentType: "received" | "made",
) {
  const key = paymentType === "received" ? "accounts_receivable" : "accounts_payable";
  const account = await accountsRepo.getSystemAccount(tx, key);
  if (!account) {
    throw new Error(
      `${paymentType === "received" ? "Accounts Receivable" : "Accounts Payable"} account is not configured.`,
    );
  }
  return account;
}

/**
 * Where an uncleared receipt waits, if the tenant runs such an account.
 *
 * Optional by design: no chart of accounts seeds `undeposited_funds` today, so
 * this resolves to null and receipts post straight to the bank — which is what
 * every payment has done so far. Seed the account and cheques start waiting,
 * which is why `clearPaymentPg` below had to exist before this was wired.
 */
async function clearingAccount(
  tx: Parameters<typeof accountsRepo.getSystemAccount>[0],
) {
  return accountsRepo.getSystemAccount(tx, "undeposited_funds");
}

/**
 * The allocation rows the form serialises into a hidden input.
 *
 * `amountAllocated` IS THE KEY THE FORM ACTUALLY SENDS — `PaymentForm` builds
 * every row with it, in `addAllocation` and in `autoAllocate`. This function
 * read only `amount`, so every allocation coerced to 0 and was filtered out:
 * the payment would have been recorded and posted in full while settling no
 * invoice at all, and the page would have shown it as entirely unapplied. It
 * was never caught because nothing called this action until now.
 */
function parseAllocations(formData: FormData) {
  const raw = formData.get("allocations");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => ({
        documentId: String(a.invoiceId ?? a.billId ?? a.documentId ?? ""),
        amount: Number(a.amountAllocated ?? a.amount) || 0,
      }))
      .filter((a) => a.documentId && a.amount > 0);
  } catch {
    return [];
  }
}

/**
 * Records a payment, allocates it, and posts it — in ONE transaction.
 *
 * The Mongo path creates the payment, then allocates, then confirms, each in
 * its own write. A failure between any two leaves a payment that exists,
 * is partly allocated, and has posted nothing.
 */
export async function createPaymentPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return recordPayment(formData, { checkThreshold: true });
}

/**
 * Records a payment the approval engine has already signed off.
 *
 * Separate from `createPaymentPg` for the same reason `releaseExpensePayment`
 * is separate: it must NOT consult the threshold. The threshold is what raised
 * the approval, and re-checking it here would refuse the payment on the
 * grounds that it needs the approval it just received.
 *
 * Called from `app/mongodb/actions/approval-actions.js`. It replaces
 * `payment.confirm()`, which posted the release into the MONGO ledger — an
 * approved supplier payment, signed off and recorded, posted where no ledger
 * screen would ever show it.
 */
export async function releaseApprovedPaymentPg(
  payload: Record<string, string>,
): Promise<ActionResult> {
  const formData = new FormData();
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (v !== null && v !== undefined) formData.append(k, String(v));
  }
  return recordPayment(formData, {
    checkThreshold: false,
    paymentId: payload?.paymentId,
  });
}

async function recordPayment(
  formData: FormData,
  opts: { checkThreshold: boolean; paymentId?: string },
): Promise<ActionResult> {
  const paymentType = String(formData.get("paymentType") ?? "received");
  const amount = Number(formData.get("amount"));
  const partyId = String(formData.get("partyId") ?? "").trim();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const paymentDate = String(formData.get("paymentDate") ?? "").slice(0, 10);
  const paymentMethod = String(formData.get("paymentMethod") ?? "cash");

  if (!["received", "made"].includes(paymentType)) {
    return { success: false, error: "A payment is either received or made." };
  }
  if (!(amount > 0)) {
    return { success: false, error: "Enter an amount greater than zero." };
  }
  if (!partyId) return { success: false, error: "Choose who this payment is with." };
  if (!accountId) return { success: false, error: "Choose the cash or bank account." };
  if (!paymentDate) return { success: false, error: "A payment date is required." };

  const allocations = parseAllocations(formData);

  // Minted BEFORE the write so an approval can reference the payment it is
  // holding. Reused verbatim on release, so the id on the approval is the id
  // the payment ends up with.
  const paymentId = opts.paymentId || randomUUID();

  if (opts.checkThreshold) {
    const held = await requestApprovalIfOverThreshold(formData, {
      paymentId,
      paymentType,
      amount,
    });
    if (held) return held;
  }

  try {
    const result = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const payment = await paymentsRepo.createPayment(tx, {
          id: paymentId,
          companyId,
          paymentType: paymentType as "received" | "made",
          paymentDate,
          paymentMethod: paymentMethod as never,
          amount: amount.toFixed(4),
          partyId,
          accountId,
          reference: String(formData.get("reference") ?? "") || null,
          description: String(formData.get("description") ?? "") || null,
          notes: String(formData.get("notes") ?? "") || null,
          mpesaReceipt: String(formData.get("mpesaTransactionCode") ?? "") || null,
          mpesaPhone: String(formData.get("mpesaPhoneNumber") ?? "") || null,
          bankName: String(formData.get("bankName") ?? "") || null,
          bankReference: String(formData.get("bankTransactionReference") ?? "") || null,
          chequeNumber: String(formData.get("chequeNumber") ?? "") || null,
          createdById: user.id,
        });

        for (const a of allocations) {
          const allocation = {
            companyId,
            paymentId: payment.id,
            amount: a.amount.toFixed(4),
          };
          if (paymentType === "received") {
            await paymentsRepo.allocateToInvoice(tx, {
              ...allocation,
              invoiceId: a.documentId,
            });
          } else {
            await paymentsRepo.allocateToBill(tx, {
              ...allocation,
              billId: a.documentId,
            });
          }
        }

        await paymentsRepo.confirmPayment(tx, payment.id, user.id);

        const control = await controlAccount(tx, paymentType as "received" | "made");
        const entry =
          paymentType === "received"
            ? await paymentsRepo.postPaymentReceipt(tx, payment.id, {
                arAccountId: control.id,
                // Where the tenant runs one. `invoice-actions.ts:408` has
                // always passed this and this path never did, so the same
                // cheque cleared instantly here and waited there.
                clearingAccountId: (await clearingAccount(tx))?.id ?? null,
                postedById: user.id,
              })
            : await paymentsRepo.postPaymentMade(tx, payment.id, {
                apAccountId: control.id,
                postedById: user.id,
              });

        return { payment, entry };
      },
    );

    revalidatePath("/dashboard/payments");
    revalidatePath("/dashboard/journal");
    revalidatePath(paymentType === "received" ? "/dashboard/invoices" : "/dashboard/bills");

    return {
      success: true,
      paymentId: result.payment.id,
      paymentNumber: result.payment.paymentNumber,
      entryNumber: (result.entry as { entryNumber?: string })?.entryNumber,
      message: `Payment ${result.payment.paymentNumber} recorded`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Confirms a DRAFT payment and posts it.
 *
 * Kept for a payment created without allocations and confirmed later. The two
 * steps stay together for the reason in the header: a confirmed payment that
 * never posted is money the ledger never saw.
 */
export async function confirmPaymentPg(paymentId: string): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user }) => {
        const payment = await paymentsRepo.getPayment(tx, paymentId);
        if (!payment) throw new Error("Payment not found");

        await paymentsRepo.confirmPayment(tx, paymentId, user.id);
        const control = await controlAccount(tx, payment.paymentType);
        const entry =
          payment.paymentType === "received"
            ? await paymentsRepo.postPaymentReceipt(tx, paymentId, {
                arAccountId: control.id,
                clearingAccountId: (await clearingAccount(tx))?.id ?? null,
                postedById: user.id,
              })
            : await paymentsRepo.postPaymentMade(tx, paymentId, {
                apAccountId: control.id,
                postedById: user.id,
              });
        return { payment, entry };
      },
    );

    revalidatePath("/dashboard/payments");
    revalidatePath(`/dashboard/payments/${paymentId}`);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      paymentId,
      entryNumber: (result.entry as { entryNumber?: string })?.entryNumber,
      message: "Payment confirmed",
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The bill-payment approval threshold — this module's one reach into Mongo.
 *
 * PORTED FROM `payment-actions.js:606`, where it guarded `payment.confirm()`.
 * Without it, moving payments to Postgres would have quietly deleted a
 * financial control: every supplier payment, of any size, posting with no
 * sign-off. Nothing would have errored, which is what makes it the dangerous
 * kind of omission.
 *
 * WHERE IT SITS HAS MOVED, and deliberately. Mongo creates the payment as a
 * draft and checks the threshold at CONFIRM, so an over-threshold payment
 * exists, allocated, while it waits — and on this schema the allocation
 * triggers would have already given the bill its "paid" balance from a payment
 * the ledger had never seen. So the check happens BEFORE anything is written:
 * over the threshold, nothing is created at all, and the approval carries the
 * form's own fields as its payload. The pending payment is visible in the
 * approvals queue, which is where a thing awaiting a decision belongs.
 *
 * Approvals are their own unported module, so the seam is two dynamic imports
 * — obvious in a stack trace, easy to delete when approvals move.
 *
 * Returns an ActionResult when the payment must be held, or null to proceed.
 */
const PAYMENT_APPROVAL_BYPASS = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

async function requestApprovalIfOverThreshold(
  formData: FormData,
  meta: { paymentId: string; paymentType: string; amount: number },
): Promise<ActionResult | null> {
  // Inbound money is not a control point — receiving a large cheque needs no
  // sign-off. Mongo gates `isOutbound` only, and so does this.
  if (meta.paymentType !== "made") return null;
  if (!(meta.amount > 0)) return null;

  // Role, company and the payee's name in ONE transaction — the approval's
  // label has to say who is being paid, and the form only sends a party id.
  const partyId = String(formData.get("partyId") ?? "").trim();
  const { user, companyId, partyName } = await withAuthorizedTenant(
    [...FINANCE_WRITE_ROLES],
    async (tx, ctx) => ({
      user: ctx.user,
      companyId: ctx.companyId,
      partyName: partyId
        ? ((await partiesRepo.getParty(tx, partyId))?.name ?? null)
        : null,
    }),
  );
  if (user.role && PAYMENT_APPROVAL_BYPASS.has(user.role)) return null;

  const { getCompanyThresholds } = await import(
    "@/app/mongodb/queries/threshold-queries"
  );
  const thresholds = await getCompanyThresholds(companyId);
  const threshold = Number(thresholds?.billPaymentValue) || 0;
  if (!(threshold > 0) || meta.amount <= threshold) return null;

  // Everything needed to recreate this payment on release, including the id
  // it will take. `parseAllocations` reads `allocations` back off the rebuilt
  // FormData, so it travels as the same JSON string the form submitted.
  const payload: Record<string, string> = { paymentId: meta.paymentId };
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") payload[key] = value;
  }

  const { submitApproval } = await import(
    "@/app/mongodb/actions/approval-actions"
  );
  const result = await submitApproval({
    type: "bill_payment",
    targetRef: {
      kind: "Payment",
      id: meta.paymentId,
      label: `${partyName ?? "Supplier"} — KES ${meta.amount.toLocaleString()}`,
    },
    payload,
    reason: `Bill payment of KES ${meta.amount.toLocaleString()} exceeds threshold of KES ${threshold.toLocaleString()}`,
    context: { amount: meta.amount, threshold },
  });

  if (!result?.success) {
    return {
      success: false,
      error: result?.error ?? "Could not raise the approval.",
    };
  }

  revalidatePath("/dashboard/approvals");
  return {
    success: false,
    error: `Payment exceeds the KES ${threshold.toLocaleString()} approval threshold. Approval ${result.approval.requestNumber} has been submitted.`,
  };
}

/**
 * Cancels a payment: reverses its entry, releases what it settled, records why.
 *
 * There is no `deletePaymentPg`, and that is deliberate. The Mongo action
 * deletes DRAFT payments only, and on this layer a draft payment does not
 * survive its own transaction — `createPaymentPg` confirms and posts before it
 * returns, and `invoice-actions.ts` does the same. Porting the delete would
 * have produced a function no status can reach, which is the trap
 * `setCheckoutStatusPg` is already in. Cancellation is the operation that
 * exists, and it is the right one: a payment that reached the ledger is undone
 * by a reversal that can be audited, not by a row disappearing.
 */
export async function cancelPaymentPg(
  paymentId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "A cancellation reason is required." };
  }

  try {
    await withAuthorizedTenant([...FINANCE_WRITE_ROLES], (tx, { user }) =>
      paymentsRepo.cancelPayment(tx, paymentId, user.id, reason),
    );

    revalidatePath("/dashboard/payments");
    revalidatePath(`/dashboard/payments/${paymentId}`);
    revalidatePath("/dashboard/journal");
    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/bills");
    return { success: true, paymentId, message: "Payment cancelled" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Moves a receipt out of the clearing account once the bank confirms it.
 *
 *     DR  bank      amount
 *     CR  clearing  amount
 *
 * `clearPaymentReceipt` has been in the repository since the payments port
 * with NO CALLER — sweep question 4, and the same shape as `returnCheckout`.
 * Meanwhile `invoice-actions.ts` was already routing cheques into clearance,
 * so any tenant that seeded `undeposited_funds` would have parked receipts
 * there permanently: `pending_clearance` with nothing able to move them on.
 * Nobody hit it because nothing seeds that account, which made it a bug
 * waiting on a chart of accounts rather than a bug in the ledger.
 */
export async function clearPaymentPg(paymentId: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...FINANCE_WRITE_ROLES], async (tx, { user }) => {
      const clearing = await clearingAccount(tx);
      if (!clearing) {
        throw new Error(
          "No clearing account is configured, so there is nothing to clear from.",
        );
      }
      return paymentsRepo.clearPaymentReceipt(tx, paymentId, {
        clearingAccountId: clearing.id,
        clearedById: user.id,
      });
    });

    revalidatePath("/dashboard/payments");
    revalidatePath(`/dashboard/payments/${paymentId}`);
    revalidatePath("/dashboard/journal");
    return { success: true, paymentId, message: "Payment cleared" };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getPaymentsPg(
  filters: paymentsRepo.ListPaymentsOptions = {},
) {
  return withAuthorizedTenant([], (tx) =>
    paymentsRepo.listPayments(tx, filters),
  );
}

/**
 * What a party still owes, or is still owed — the payment form's allocation
 * picker. Any signed-in user may read it; choosing who to pay is not a write.
 */
export async function getUnpaidDocumentsPg(
  partyId: string,
  documentType: "invoice" | "bill",
) {
  if (!partyId) return [];
  if (documentType !== "invoice" && documentType !== "bill") return [];
  return withAuthorizedTenant([], (tx) =>
    paymentsRepo.listUnpaidDocuments(tx, { partyId, documentType }),
  );
}

export async function getPaymentStatsPg() {
  return withAuthorizedTenant([], (tx) => paymentsRepo.getPaymentStats(tx));
}

export async function getPaymentPg(paymentId: string) {
  return withAuthorizedTenant([], (tx) => paymentsRepo.getPayment(tx, paymentId));
}

export async function getUnappliedPaymentsPg(limit = 50) {
  return withAuthorizedTenant([], (tx) =>
    paymentsRepo.getUnappliedPayments(tx, limit),
  );
}

/** Cash, bank and M-Pesa accounts a payment can move through. */
export async function getPaymentAccountsPg() {
  return withAuthorizedTenant([], (tx) => accountsRepo.listPaymentAccounts(tx));
}
