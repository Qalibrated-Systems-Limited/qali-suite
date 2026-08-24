"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as paymentsRepo from "../repositories/payments";
import * as accountsRepo from "../repositories/accounts";

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

function parseAllocations(formData: FormData) {
  const raw = formData.get("allocations");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => ({
        documentId: String(a.invoiceId ?? a.billId ?? a.documentId ?? ""),
        amount: Number(a.amount) || 0,
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

  try {
    const result = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const payment = await paymentsRepo.createPayment(tx, {
          companyId,
          paymentType: paymentType as "received" | "made",
          paymentDate,
          paymentMethod: paymentMethod as never,
          amount: amount.toFixed(4),
          partyId,
          accountId,
          reference: String(formData.get("reference") ?? "") || null,
          description: String(formData.get("description") ?? "") || null,
          mpesaReceipt: String(formData.get("mpesaTransactionCode") ?? "") || null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getPaymentsPg(
  filters: { paymentType?: string; status?: string; partyId?: string; limit?: number } = {},
) {
  return withAuthorizedTenant([], (tx) =>
    paymentsRepo.listPayments(tx, filters as never),
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
