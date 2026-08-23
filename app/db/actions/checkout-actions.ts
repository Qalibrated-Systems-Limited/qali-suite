"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { INVENTORY_WRITE_ROLES, FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as fulfilment from "../repositories/fulfilment";
import * as productsRepo from "../repositories/products";
import * as accountsRepo from "../repositories/accounts";

/**
 * Item checkouts on Postgres — the last module out of the Mongo ledger.
 *
 * `item_checkouts` and three of its repository functions have existed since
 * the fulfilment port, uncalled, and `returnCheckout` posted nothing: stock
 * came back into the warehouse while its value stayed on the technician-stock
 * account. This is the layer that was missing.
 *
 * Two postings:
 *   return   DR Inventory / CR Technician Stock
 *   expense  DR Expense   / CR Technician Stock
 *
 * Both value the stock at the product's CURRENT cost price. The Mongo path
 * takes it from the stock movement, which is the value it left at — a
 * difference worth knowing about, and the reason the cost is passed into the
 * repository rather than read there. Where the two disagree, the residue lands
 * in whichever account absorbs it; see the note on the return action.
 */

export type ActionResult =
  | { success: true; checkoutId?: string; entryNumber?: string; message?: string }
  | { success: false; error: string; message?: string };

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not found") ||
    message.includes("already") ||
    message.includes("Only a checkout") ||
    message.includes("settled") ||
    message.includes("Say what") ||
    message.includes("more than") ||
    message.includes("permission") ||
    message.includes("not configured")
  ) {
    return { success: false, error: message, message };
  }
  const friendly = userMessage(err, "Something went wrong with this checkout.");
  return { success: false, error: friendly, message: friendly };
}

/** What a quantity of a product is worth, at its current cost. */
async function valueOf(
  tx: Parameters<typeof productsRepo.getProduct>[0],
  productId: string,
  quantity: string,
) {
  const product = await productsRepo.getProduct(tx, productId);
  if (!product) return "0";
  return (Number(product.costPrice ?? 0) * Number(quantity)).toFixed(4);
}

/**
 * Returns checked-out stock: DR Inventory / CR Technician Stock.
 *
 * The posting is SKIPPED, not failed, when the inventory or technician-stock
 * account is missing or the value is zero. Refusing the return would leave the
 * stock recorded as still out — with somebody who has physically handed it
 * back — which is worse than a missing journal entry that an accountant can
 * see and correct.
 */
export async function returnCheckoutPg(
  checkoutId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const quantity = String(formData.get("quantity") ?? "").trim();
  const condition = String(formData.get("returnCondition") ?? "").trim();
  const notes = String(formData.get("returnNotes") ?? "").trim();

  if (!(Number(quantity) > 0)) {
    return { success: false, error: "Enter how many are coming back.", message: "Enter how many are coming back." };
  }

  try {
    const result = await withAuthorizedTenant(
      [...INVENTORY_WRITE_ROLES],
      async (tx, { user }) => {
        const checkout = await fulfilment.getCheckoutById(tx, checkoutId);
        if (!checkout) throw new Error("Checkout not found");

        const inventory = await accountsRepo.getSystemAccount(tx, "inventory");
        const techStock = await accountsRepo.getSystemAccount(tx, "technician_stock");

        return fulfilment.returnCheckout(tx, checkoutId, {
          quantity: Number(quantity).toFixed(4),
          condition: (condition || undefined) as never,
          notes: notes || null,
          returnedById: user.id,
          returnedByName: user.name,
          totalCost: await valueOf(tx, checkout.productId, quantity),
          inventoryAccountId: inventory?.id ?? null,
          technicianStockAccountId: techStock?.id ?? null,
        });
      },
    );

    revalidatePath("/dashboard/checkout");
    revalidatePath(`/dashboard/checkout/${checkoutId}`);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      checkoutId,
      entryNumber: result.entry?.entryNumber,
      message: "Return recorded",
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Converts checked-out stock into an expense: DR Expense / CR Technician Stock.
 *
 * Here the accounts are REQUIRED, unlike the return. The whole purpose of the
 * action is to move value into an expense account — without one there is
 * nothing to do, and silently marking the stock expensed would lose it.
 */
export async function expenseInternalCheckoutPg(
  checkoutId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const quantity = String(formData.get("quantity") ?? "").trim();
  const expenseAccountId = String(formData.get("expenseAccountId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!(Number(quantity) > 0)) {
    return { success: false, error: "Enter a quantity.", message: "Enter a quantity." };
  }
  if (!expenseAccountId) {
    return {
      success: false,
      error: "Choose the expense account to charge this to.",
      message: "Choose the expense account to charge this to.",
    };
  }
  if (reason.length < 3) {
    return { success: false, error: "Say what the stock was used for.", message: "Say what the stock was used for." };
  }

  try {
    const result = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user }) => {
        const checkout = await fulfilment.getCheckoutById(tx, checkoutId);
        if (!checkout) throw new Error("Checkout not found");

        const [expenseAccount] = await accountsRepo.listAccounts(tx, {
          accountType: "expense",
          postableOnly: true,
        }).then((rows) => rows.filter((a) => a.id === expenseAccountId));
        if (!expenseAccount) {
          throw new Error("That expense account is not available to post to.");
        }

        const techStock = await accountsRepo.getSystemAccount(tx, "technician_stock");
        if (!techStock) {
          throw new Error("Technician Stock account is not configured.");
        }

        return fulfilment.expenseCheckout(tx, checkoutId, {
          quantity: Number(quantity).toFixed(4),
          totalCost: await valueOf(tx, checkout.productId, quantity),
          expenseAccountId: expenseAccount.id,
          expenseAccountCode: expenseAccount.accountCode,
          expenseAccountName: expenseAccount.accountName,
          technicianStockAccountId: techStock.id,
          reason,
          expensedById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/checkout");
    revalidatePath(`/dashboard/checkout/${checkoutId}`);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      checkoutId,
      entryNumber: result.entry.entryNumber,
      message: "Booked to expense",
    };
  } catch (err) {
    return fail(err);
  }
}

export async function escalateCheckoutPg(
  checkoutId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const escalatedToId = String(formData.get("escalatedToId") ?? "").trim();
  const escalatedToName = String(formData.get("escalatedToName") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!escalatedToId || !escalatedToName) {
    return {
      success: false,
      error: "Say who this is being escalated to.",
      message: "Say who this is being escalated to.",
    };
  }

  try {
    await withAuthorizedTenant([...INVENTORY_WRITE_ROLES], (tx) =>
      fulfilment.escalateCheckout(tx, checkoutId, {
        escalatedToId,
        escalatedToName,
        reason,
      }),
    );
    revalidatePath("/dashboard/checkout");
    revalidatePath(`/dashboard/checkout/${checkoutId}`);
    return { success: true, checkoutId, message: "Escalated" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Marks a checkout overdue, lost or damaged.
 *
 * NO SCREEN CALLS THIS, and none called the Mongo `updateCheckoutStatus` it
 * was ported from either — `find-unwired-actions.mjs` flags it, and checking
 * the history shows it was already dead before the port. It is kept rather
 * than dropped because "lost" and "damaged" are real states the enum carries
 * and the list filters on, so the gap is a missing UI rather than a dead idea.
 * If no screen wants it, delete this and the two enum values together.
 *
 * `returned` and `expensed` are NOT reachable here — they move value, and the
 * Mongo action let a store manager set them from a dropdown, which changed the
 * status without posting anything or touching a quantity counter.
 */
export async function setCheckoutStatusPg(
  checkoutId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const status = String(formData.get("status") ?? "").trim();
  const damageDetails = String(formData.get("damageDetails") ?? "").trim();

  if (!["overdue", "lost", "damaged"].includes(status)) {
    return {
      success: false,
      error:
        "Returning or expensing a checkout has to go through the return or expense action, so the ledger moves with it.",
      message:
        "Returning or expensing a checkout has to go through the return or expense action, so the ledger moves with it.",
    };
  }

  try {
    await withAuthorizedTenant([...INVENTORY_WRITE_ROLES], (tx) =>
      fulfilment.setCheckoutStatus(
        tx,
        checkoutId,
        status as "overdue" | "lost" | "damaged",
        { damageDetails: damageDetails || null },
      ),
    );
    revalidatePath("/dashboard/checkout");
    revalidatePath(`/dashboard/checkout/${checkoutId}`);
    return { success: true, checkoutId, message: `Marked ${status}` };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function searchCheckoutsPg(
  search = "",
  page = 1,
  filters: { status?: string } = {},
) {
  return withAuthorizedTenant([], (tx) =>
    fulfilment.searchCheckouts(tx, { search, page, status: filters.status }),
  );
}

export async function getCheckoutByIdPg(checkoutId: string) {
  return withAuthorizedTenant([], (tx) =>
    fulfilment.getCheckoutById(tx, checkoutId),
  );
}

export async function getCheckoutStatsPg() {
  return withAuthorizedTenant([], (tx) => fulfilment.getCheckoutStats(tx));
}

/** The expense accounts the internal-use dialog offers. */
export async function getCheckoutExpenseAccountsPg() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await accountsRepo.listAccounts(tx, {
      accountType: "expense",
      postableOnly: true,
    });
    return rows.map((a) => ({
      _id: a.id,
      id: a.id,
      accountCode: a.accountCode,
      accountName: a.accountName,
    }));
  });
}
