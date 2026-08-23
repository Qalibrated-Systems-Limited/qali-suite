"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as openingBalances from "../repositories/openingBalances";
import * as invoicesRepo from "../repositories/invoices";
import * as billsRepo from "../repositories/bills";
import * as accountsRepo from "../repositories/accounts";
import {
  setConversionDate as setPlatformConversionDate,
  getConversion,
} from "../platform";

/**
 * Opening balances on Postgres (0061) — the cutover flow.
 *
 * The Mongo module posted the lump entry through the Mongoose JournalEntry
 * model while every ledger screen read Postgres, so a company's entire opening
 * position went into a ledger nothing displays.
 *
 * Its Postgres half was worse than absent: `createOpeningBalanceBill` existed
 * in the bills repository with no caller and no journal posting behind it, so
 * it looked done and would have produced a payable the trial balance never saw.
 * Both opening documents post now.
 */

export type ActionResult =
  | {
      success: true;
      entryNumber?: string;
      invoiceNumber?: string;
      billNumber?: string;
      openingBalanceEquity?: number;
      message?: string;
    }
  | { success: false; error: string };

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("already posted") ||
    message.includes("at least") ||
    message.includes("cannot have both") ||
    message.includes("could not be found") ||
    message.includes("header account") ||
    message.includes("not found") ||
    message.includes("not an opening") ||
    message.includes("already reversed") ||
    message.includes("greater than zero") ||
    message.includes("not configured") ||
    message.includes("conversion date") ||
    message.includes("date is required") ||
    message.includes("date is invalid") ||
    message.includes("permission")
  ) {
    return { success: false, error: message };
  }
  return { success: false, error: userMessage(err, "Failed to book opening balances.") };
}

async function openingEquityOrThrow(tx: Parameters<typeof accountsRepo.getSystemAccount>[0]) {
  const obe = await accountsRepo.getSystemAccount(tx, "opening_balance_equity");
  if (!obe) {
    throw new Error(
      "Opening Balance Equity account is not configured for this company.",
    );
  }
  return obe;
}

export async function postOpeningBalancesPg(input: {
  entryDate: string;
  lines: Array<{ accountId: string; debit?: number; credit?: number }>;
}): Promise<ActionResult> {
  if (!input?.entryDate) {
    return { success: false, error: "A cutover date is required." };
  }

  try {
    const result = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const obe = await openingEquityOrThrow(tx);
        return openingBalances.postOpeningBalances(tx, {
          companyId,
          entryDate: input.entryDate.slice(0, 10),
          lines: input.lines.map((l) => ({
            accountId: String(l.accountId ?? ""),
            debit: (Number(l.debit) || 0).toFixed(4),
            credit: (Number(l.credit) || 0).toFixed(4),
          })),
          openingEquityAccountId: obe.id,
          createdById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    revalidatePath("/dashboard/reports/balance-sheet");

    return {
      success: true,
      entryNumber: result.entry.entryNumber,
      openingBalanceEquity: result.openingBalanceEquity,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The conversion date.
 *
 * Already mirrored to Postgres by the Mongo action, under a comment saying
 * "nothing reads the Postgres copy yet". Now it is the only copy.
 */
export async function setConversionDatePg(input: {
  date: string;
}): Promise<ActionResult> {
  if (!input?.date) {
    return { success: false, error: "A conversion date is required." };
  }
  const conv = new Date(input.date);
  if (Number.isNaN(conv.getTime())) {
    return { success: false, error: "The conversion date is invalid." };
  }

  try {
    await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (_tx, { user, companyId }) => {
        await setPlatformConversionDate(companyId, conv, {
          id: user.id,
          name: user.name,
        });
      },
    );
    revalidatePath("/dashboard/accounts/opening-balances");
    return { success: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The window an opening document must fall in.
 *
 * Two rules, both carried over from `resolveConversionWindow`: there must BE a
 * cutover date, and the document must fall on or before it. An opening
 * document dated after the cutover is not an opening balance — it is a real
 * transaction wearing the wrong label, and it would post to Opening Balance
 * Equity instead of to revenue or an expense.
 *
 * The Mongo version read the date from Mongo on purpose, with a comment
 * explaining that reading it from Postgres while the rule was checked against
 * the Mongo ledger "puts the rule's data in a different store from the rule's
 * subject". Both are Postgres now, so that reason has expired.
 */
async function conversionWindow(companyId: string, docDate: string, label: string) {
  if (!docDate) return { error: `A ${label} date is required.` as const };
  const d = new Date(docDate);
  if (Number.isNaN(d.getTime())) {
    return { error: `The ${label} date is invalid.` as const };
  }

  const conversion = await getConversion(companyId);
  if (!conversion?.date) {
    return {
      error:
        "Set your conversion (cutover) date before entering opening documents." as const,
    };
  }
  if (docDate.slice(0, 10) > String(conversion.date).slice(0, 10)) {
    return {
      error: `The ${label} date must be on or before the conversion date.` as const,
    };
  }
  return { docDate: docDate.slice(0, 10) };
}

/** An opening receivable: Dr Accounts Receivable / Cr Opening Balance Equity. */
export async function createOpeningInvoicePg(input: {
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  amount: number;
}): Promise<ActionResult> {
  try {
    const { invoice } = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const win = await conversionWindow(companyId, input.invoiceDate, "invoice");
        if ("error" in win) throw new Error(win.error);

        const ar = await accountsRepo.getSystemAccount(tx, "accounts_receivable");
        if (!ar) {
          throw new Error("Accounts Receivable account is not configured.");
        }
        const obe = await openingEquityOrThrow(tx);
        const date = win.docDate;

        return invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId,
          customerId: input.customerId,
          invoiceDate: date,
          dueDate: (input.dueDate || input.invoiceDate).slice(0, 10),
          amount: (Number(input.amount) || 0).toFixed(4),
          arAccountId: ar.id,
          openingEquityAccountId: obe.id,
          createdById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true, invoiceNumber: invoice.invoiceNumber };
  } catch (err) {
    return fail(err);
  }
}

/** An opening payable: Dr Opening Balance Equity / Cr Accounts Payable. */
export async function createOpeningBillPg(input: {
  supplierId: string;
  billDate: string;
  dueDate?: string;
  amount: number;
}): Promise<ActionResult> {
  try {
    const { bill } = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const win = await conversionWindow(companyId, input.billDate, "bill");
        if ("error" in win) throw new Error(win.error);

        const ap = await accountsRepo.getSystemAccount(tx, "accounts_payable");
        if (!ap) {
          throw new Error("Accounts Payable account is not configured.");
        }
        const obe = await openingEquityOrThrow(tx);
        const date = win.docDate;

        return billsRepo.createOpeningBalanceBill(tx, {
          companyId,
          supplierId: input.supplierId,
          billDate: date,
          dueDate: (input.dueDate || input.billDate).slice(0, 10),
          amount: (Number(input.amount) || 0).toFixed(4),
          apAccountId: ap.id,
          openingEquityAccountId: obe.id,
          createdById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true, billNumber: bill.billNumber };
  } catch (err) {
    return fail(err);
  }
}

export async function reverseOpeningInvoicePg(
  invoiceId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...FINANCE_WRITE_ROLES], (tx, { user }) =>
      openingBalances.reverseOpeningInvoice(tx, invoiceId, {
        reversedById: user.id,
      }),
    );
    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true, message: "Opening invoice reversed" };
  } catch (err) {
    return fail(err);
  }
}

export async function reverseOpeningBillPg(
  billId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...FINANCE_WRITE_ROLES], (tx, { user }) =>
      openingBalances.reverseOpeningBill(tx, billId, { reversedById: user.id }),
    );
    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true, message: "Opening bill reversed" };
  } catch (err) {
    return fail(err);
  }
}

export async function getOpeningBalanceSetupPg() {
  const setup = await withAuthorizedTenant([], (tx) =>
    openingBalances.getOpeningBalanceSetup(tx),
  );

  /**
   * The cutover date, read from Postgres.
   *
   * It lives on `companies`, outside the tenant-scoped tables, so it comes
   * from the platform module rather than the repository. The Mongo action has
   * been mirroring it here since 0035 under a comment reading "nothing reads
   * the Postgres copy yet" — this is the read that makes the mirror the
   * original.
   *
   * OpeningDocsSection gates on it: no cutover date, no opening documents.
   */
  const conversion = await withAuthorizedTenant([], async (_tx, { companyId }) =>
    getConversion(companyId),
  );

  return { ...setup, conversionDate: conversion?.date ?? null };
}
