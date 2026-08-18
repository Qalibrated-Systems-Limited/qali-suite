"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { BILL_WRITE_ROLES, BILL_APPROVE_ROLES, ADMIN_ROLES } from "@/lib/utils/role-gates";
import * as billsRepo from "../repositories/bills";
import * as accountsRepo from "../repositories/accounts";
import * as partiesRepo from "../repositories/parties";
import * as productsRepo from "../repositories/products";
import * as paymentsRepo from "../repositories/payments";

/**
 * Postgres-backed bill actions.
 *
 * Thin by design (§4.1): tenant + role gating, then a call into the
 * repository. Every accounting rule is below this — balanced postings (0001),
 * exact overpayment refusal via CHECK (balance >= 0) (0016), trigger-maintained
 * header totals, and the stock movements inside the approval's transaction.
 *
 * Money is strings end to end. Never Number() these values.
 *
 * app/mongodb/actions/bill-actions.js is the reference for BEHAVIOUR, not for
 * implementation. Where it is wrong, this does not follow it; each such point
 * is called out at the site.
 */

/**
 * The shape the existing client components already handle, so a component can
 * change data source without changing.
 */
export type ActionResult =
  | { success: true; billId?: string; billNumber?: string; message?: string }
  | { success: false; error: string };

/**
 * Postgres phrases these violations for a user already — an unbalanced entry,
 * a closed period, a missing system account, stock that would go negative.
 * Surface those; hide anything else behind a generic message and a log line,
 * so an internal error never leaks a query or a column name to the UI.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not balanced") ||
    message.includes("fiscal period") ||
    message.includes("system account") ||
    message.includes("not configured") ||
    message.includes("GR/IR") ||
    message.includes("Bill not found") ||
    message.includes("not in submitted status") ||
    message.includes("Only draft bills") ||
    message.includes("Cannot edit a bill") ||
    message.includes("cannot be changed") ||
    message.includes("must have at least one line") ||
    message.includes("Supplier not found") ||
    message.includes("Account not found") ||
    message.includes("expense or asset") ||
    message.includes("must be approved before") ||
    message.includes("balance_non_negative") ||
    message.includes("already been posted") ||
    message.includes("exceeds") ||
    message.includes("Party not found") ||
    message.includes("already cancelled") ||
    message.includes("has been paid against it") ||
    message.includes("capitalised") ||
    message.includes("quantity_on_hand") ||
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    message.includes("approve") ||
    message.includes("has not been migrated")
  ) {
    return message;
  }
  console.error("Bill action failed:", err);
  return "Something went wrong. Please try again.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bills list page.
 *
 * Note what is NOT passed: a companyId. RLS supplies it, and forgetting it
 * returns zero rows rather than another tenant's payables (§2.2).
 */
export async function listBillsForPage(opts: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  paymentStatus?: string;
  supplierId?: string;
}) {
  const result = await withAuthorizedTenant([], (tx) =>
    billsRepo.searchBills(tx, {
      query: opts.search,
      page: opts.page,
      perPage: opts.limit,
      status: opts.status || undefined,
      paymentStatus: opts.paymentStatus || undefined,
      supplierId: opts.supplierId || undefined,
    }),
  );

  return {
    bills: result.bills,
    pagination: {
      page: result.page,
      total: result.total,
      totalPages: result.totalPages,
    },
  };
}

/**
 * Approved bills still awaiting a goods receipt — the GRN form's source picker.
 */
export async function getBillsAwaitingGRN() {
  return withAuthorizedTenant([], (tx) => billsRepo.listBillsAwaitingGRN(tx));
}

/** The four figures the list page's cards read. */
export async function getBillsStats() {
  return withAuthorizedTenant([], (tx) => billsRepo.getBillStats(tx));
}

/**
 * One bill, shaped for the detail page.
 *
 * Returns `{ bill: null }` for a bill in another tenant rather than throwing:
 * RLS filtered the row out before the query saw it, so it reads as absent and
 * the page 404s. Invisible rather than forbidden, which is the point of §2.2 —
 * a "you may not see this" response confirms the row exists.
 */
export async function getBillById(billId: string) {
  try {
    const bill = await withAuthorizedTenant([], (tx) =>
      billsRepo.getBillDetail(tx, billId),
    );
    return { bill, error: bill ? null : "Bill not found" };
  } catch (err) {
    return { bill: null, error: toActionError(err) };
  }
}

/**
 * Cash, bank and M-Pesa accounts the bill payment dialog offers.
 *
 * Gated on BILL_WRITE_ROLES rather than reusing invoice-actions'
 * getPaymentAccountsPg: that one is gated on INVOICE_WRITE_ROLES, which
 * includes Sales Manager and excludes Procurement Officer — the wrong gate for
 * a payables screen in both directions.
 */
export async function getPaymentAccounts() {
  return withAuthorizedTenant([...BILL_WRITE_ROLES], (tx) =>
    accountsRepo.listPaymentAccounts(tx),
  );
}

/**
 * Everything BillForm's pickers need, in the shapes it already expects.
 *
 * NOT here: fixed assets and projects. Neither module is ported (§10), and the
 * bill keeps `project_id` / `asset_id` as deferred references with name
 * snapshots beside them. The create page still reads those two from Mongo, and
 * that is the honest state of it rather than something to paper over.
 *
 * The lists are capped by the repositories at 200. That is deliberate — an
 * unbounded picker is a page that gets slower every month — but it means a
 * tenant past 200 suppliers needs a searching picker rather than a longer cap.
 */
export async function getBillFormData() {
  return withAuthorizedTenant([...BILL_WRITE_ROLES], async (tx) => {
    const [suppliers, allAccounts, productList] = await Promise.all([
      partiesRepo.listParties(tx, { role: "supplier", limit: 200 }),
      accountsRepo.listAccounts(tx, { postableOnly: true }),
      productsRepo.listProducts(tx, { limit: 200 }),
    ]);

    return {
      suppliers: suppliers.map((s) => ({
        _id: s.id,
        name: s.name,
        taxPin: s.taxPin ?? "",
        email: s.email ?? "",
        phone: s.phone ?? "",
        address: [s.addressLine1, s.city].filter(Boolean).join(", "),
      })),
      // A bill line charges an expense or an asset; createBill refuses
      // anything else, so the picker offers exactly what will be accepted.
      accounts: allAccounts
        .filter((a) => a.accountType === "expense" || a.accountType === "asset")
        .map((a) => ({
          _id: a.id,
          accountCode: a.accountCode,
          accountName: a.accountName,
          accountType: a.accountType,
          subType: a.subType ?? null,
          // Lets the form auto-pick Inventory when a product is chosen.
          systemAccount: a.systemAccount ?? null,
        })),
      products: productList.map((p) => ({
        _id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit ?? "pcs",
        costPrice: p.costPrice,
      })),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Create and edit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BillForm submits indexed fields — `lines[0].description` — so the payload is
 * reassembled the same way the reference does, and the form did not change.
 */
function parseFormData(formData: FormData) {
  const data: Record<string, unknown> = {};
  const lines: Array<Record<string, string>> = [];

  for (const [key, value] of formData.entries()) {
    const match = key.match(/^lines\[(\d+)\]\.(.+)$/);
    if (match) {
      const [, index, prop] = match;
      const i = Number(index);
      lines[i] = { ...(lines[i] ?? {}), [prop]: String(value) };
    } else {
      data[key] = String(value);
    }
  }

  // Removing a line leaves a hole in the indices, so the array is sparse.
  data.lines = lines.filter(Boolean);
  return data as Record<string, unknown> & { lines: Array<Record<string, string>> };
}

const billLineSchema = z.object({
  description: z.string().min(1, "Description is required"),
  accountId: z.string().min(1, "Account is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  unit: z.string().optional(),
  productId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
});

const billSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  supplierInvoiceNumber: z.string().optional(),
  billDate: z.string().min(1, "Bill date is required"),
  dueDate: z.string().min(1, "Due date is required"),
  whtApplicable: z.string().optional(),
  whtRate: z.coerce.number().min(0).max(30).default(0),
  title: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  internalNotes: z.string().optional(),
  projectId: z.string().optional().nullable(),
  lines: z.array(billLineSchema).min(1, "Add at least one line item"),
});

/** Dates arrive as ISO strings or datetime-local values; the column is a date. */
const toDateOnly = (v: string) => String(v).slice(0, 10);
/** Money crosses this boundary as a string and stays one. */
const money = (n: number) => n.toFixed(4);

type FormResult =
  | { success: true; billId: string; billNumber: string; message: string }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      values?: unknown;
    };

/**
 * Empty string is what a cleared <select> submits, and it is not a uuid. Left
 * as-is it reaches Postgres as `''::uuid` and fails with a type error rather
 * than a message anyone can act on.
 */
const optionalId = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

function toBillInput(data: z.infer<typeof billSchema>) {
  return {
    supplierId: data.supplierId,
    supplierInvoiceNumber: data.supplierInvoiceNumber || null,
    billDate: toDateOnly(data.billDate),
    dueDate: toDateOnly(data.dueDate),
    // A checkbox submits "on" when ticked and nothing at all when not; the
    // form also sends the string "true". Both mean the same thing.
    whtApplicable: data.whtApplicable === "true" || data.whtApplicable === "on",
    whtRate: money(data.whtRate),
    title: data.title || null,
    reference: data.reference || null,
    description: data.description || null,
    internalNotes: data.internalNotes || null,
    projectId: optionalId(data.projectId),
    lines: data.lines.map((l) => ({
      description: l.description,
      accountId: l.accountId,
      quantity: money(l.quantity),
      unitPrice: money(l.unitPrice),
      vatRate: money(l.vatRate),
      unit: l.unit || "pcs",
      productId: optionalId(l.productId),
      assetId: optionalId(l.assetId),
    })),
  };
}

export async function createBill(
  _prevState: unknown,
  formData: FormData,
): Promise<FormResult> {
  const raw = parseFormData(formData);
  const parsed = billSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      success: false,
      error: "Please correct the highlighted fields",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }

  try {
    const bill = await withAuthorizedTenant(
      [...BILL_WRITE_ROLES],
      async (tx, { user, companyId }) =>
        billsRepo.createBill(tx, {
          companyId,
          ...toBillInput(parsed.data),
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        }),
    );

    revalidatePath("/dashboard/bills");
    return {
      success: true,
      billId: bill.id,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err), values: raw };
  }
}

export async function updateBill(
  billId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<FormResult> {
  const raw = parseFormData(formData);
  const parsed = billSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      success: false,
      error: "Please correct the highlighted fields",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }

  try {
    const bill = await withAuthorizedTenant([...BILL_WRITE_ROLES], (tx) =>
      billsRepo.updateBill(tx, billId, toBillInput(parsed.data)),
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    return {
      success: true,
      billId,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} updated`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err), values: raw };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment
// ─────────────────────────────────────────────────────────────────────────────

const billPaymentSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  paymentMethod: z.enum(["cash", "mpesa", "bank_transfer", "cheque", "card"], {
    message: "Please select a payment method",
  }),
  accountId: z.string().min(1, "Please select a payment account"),
  paymentDate: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Pays a bill: creates the payment, allocates it, and posts it — one
 * transaction, so all three happen or none does.
 *
 * The overpayment guard is the database's. CHECK (balance >= 0) on bills is
 * exact, and the deferred trigger on payment_allocations enforces
 * SUM(allocated) <= amount at COMMIT. bill-actions.js:1438 compares
 * `amount > balance + 0.01` and lets a bill be overpaid by up to a cent (§9C).
 * Nothing here restates either rule, because restating it is how the two
 * copies in the reference came to disagree.
 *
 * The posting is NOT best-effort. If the entry cannot be written the payment
 * does not exist either, rather than the bill showing settled against a ledger
 * that never saw the money leave.
 */
export async function createBillPayment(
  billId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult & { fieldErrors?: Record<string, string> }> {
  // formData.get() returns null for an absent field, and `.optional()` admits
  // undefined, not null — so an omitted note failed the schema as a type error
  // rather than being treated as omitted.
  const field = (name: string) => formData.get(name) ?? undefined;
  const parsed = billPaymentSchema.safeParse({
    amount: field("amount"),
    paymentMethod: field("paymentMethod"),
    accountId: field("accountId"),
    paymentDate: field("paymentDate"),
    reference: field("reference"),
    notes: field("notes"),
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const first = Object.values(flat).flat()[0];
    return {
      success: false,
      error: String(first ?? "Please correct the highlighted fields"),
      fieldErrors: Object.fromEntries(
        Object.entries(flat).map(([k, v]) => [k, String(v?.[0] ?? "")]),
      ),
    };
  }
  const data = parsed.data;

  try {
    const result = await withAuthorizedTenant(
      [...BILL_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const bill = await billsRepo.getBill(tx, billId);
        if (!bill) throw new Error("Bill not found");
        if (bill.status !== "approved") {
          throw new Error("A bill must be approved before it can be paid");
        }

        const ap = await accountsRepo.getSystemAccount(tx, "accounts_payable");
        if (!ap) {
          throw new Error("Accounts Payable system account not configured");
        }

        const payment = await paymentsRepo.createPayment(tx, {
          companyId,
          paymentType: "made",
          paymentDate: (data.paymentDate || new Date().toISOString()).slice(0, 10),
          paymentMethod: data.paymentMethod,
          amount: money(data.amount),
          partyId: bill.supplierId,
          accountId: data.accountId,
          reference: data.reference || null,
          description: data.notes || `Payment for bill ${bill.billNumber}`,
          createdById: user.id,
        });

        await paymentsRepo.allocateToBill(tx, {
          companyId,
          paymentId: payment.id,
          billId,
          amount: money(data.amount),
        });

        await paymentsRepo.postPaymentMade(tx, payment.id, {
          apAccountId: ap.id,
          postedById: user.id,
        });

        return { payment, billNumber: bill.billNumber };
      },
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      billId,
      billNumber: result.billNumber,
      message: `Payment ${result.payment.paymentNumber} recorded against ${result.billNumber}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow
// ─────────────────────────────────────────────────────────────────────────────

export async function submitBill(billId: string): Promise<ActionResult> {
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_WRITE_ROLES],
      async (tx, { user }) =>
        billsRepo.submitBill(tx, billId, user.id, user.name),
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    return {
      success: true,
      billId,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} submitted for approval`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Approves a bill: posts the purchase entry, admits any stock the bill
 * receives, and records the VAT and WHT — all in one transaction.
 *
 * SEPARATION OF DUTIES is checked here, and the honest account of why is
 * narrower than "roles live in Mongo".
 *
 * The BASE RULE needs no roles at all. `approved_by_id <> submitted_by_id`
 * compares two values already on the row, and could be a CHECK today — it does
 * not depend on users being ported. What needs a role is only the OVERRIDE
 * below, and an override is exactly the part of a separation-of-duties control
 * an auditor asks about.
 *
 * So this is not "the rule cannot move to the database". It is "the rule can,
 * and the exemption cannot, and shipping the rule without the exemption would
 * change who can approve what". That is a product decision, and it is worth
 * making deliberately rather than as a side effect of a migration.
 *
 * One difference from the reference: it treats SuperAdmin as outranking Admin.
 * bill-actions.js:1088 tests `user.role !== "Admin"`, so a SuperAdmin who
 * submitted a bill cannot approve it while an Admin can — the one place in the
 * codebase where SuperAdmin has less authority than Admin.
 */
export async function approveBill(billId: string): Promise<ActionResult> {
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      async (tx, { user }) => {
        const existing = await billsRepo.getBill(tx, billId);
        if (!existing) throw new Error("Bill not found");

        if (
          existing.submittedById === user.id &&
          !ADMIN_ROLES.includes(user.role)
        ) {
          throw new Error(
            "You cannot approve a bill you submitted. Ask another approver.",
          );
        }

        const ap = await accountsRepo.getSystemAccount(tx, "accounts_payable");
        if (!ap) {
          throw new Error("Accounts Payable system account not configured");
        }
        const vatInput = await accountsRepo.getSystemAccount(tx, "vat_input");
        const whtPayable = await accountsRepo.getSystemAccount(tx, "wht_payable");
        const inventory = await accountsRepo.getSystemAccount(tx, "inventory");
        // Optional: only a three-way-match tenant maps one, and approveBill
        // raises a named error if a line needs it and it is absent.
        const grni = await accountsRepo.getSystemAccount(tx, "grni");

        return billsRepo.approveBill(tx, billId, {
          apAccountId: ap.id,
          vatInputAccountId: vatInput?.id ?? null,
          whtPayableAccountId: whtPayable?.id ?? null,
          inventoryAccountId: inventory?.id ?? null,
          grniAccountId: grni?.id ?? null,
          approvedById: user.id,
          approvedByName: user.name,
        });
      },
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/journal");
    revalidatePath("/dashboard/stocks");
    return {
      success: true,
      billId,
      billNumber: bill.bill.billNumber,
      message: `Bill ${bill.bill.billNumber} approved and posted`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Signatures match the Mongo actions the components already call —
 * `(billId, prevState, formData)` — so BillDetailActions switched data source
 * without changing a call site.
 */
export async function rejectBill(
  billId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Please provide a rejection reason" };
  }
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      async (tx, { user }) =>
        billsRepo.rejectBill(tx, billId, user.id, reason, user.name),
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    return {
      success: true,
      billId,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} rejected`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Cancels a bill, undoing everything its approval did: the purchase entry is
 * REVERSED rather than deleted, and any stock the bill admitted is taken back —
 * both inside one transaction, and both refused outright if the goods have
 * since been consumed or any payment has been made against it.
 */
export async function cancelBill(
  billId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Please provide a cancellation reason" };
  }
  try {
    const bill = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      async (tx, { user }) =>
        billsRepo.cancelBill(tx, billId, user.id, reason, user.name),
    );

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/journal");
    revalidatePath("/dashboard/stocks");
    return {
      success: true,
      billId,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} cancelled`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Deletes a draft bill.
 *
 * The reference gates this on `isOwner(user, bill.createdBy) || hasRole(...)`.
 * Ownership is not carried here: created_by_id holds a Mongo user id today and
 * the id map does not cover users, so an owner check would compare values that
 * cannot be relied on to match. The role gate is the honest one until users
 * are in Postgres — and it is the stricter of the two, not the looser.
 */
export async function deleteBill(billId: string): Promise<ActionResult> {
  try {
    const { billNumber } = await withAuthorizedTenant(
      [...BILL_APPROVE_ROLES],
      (tx) => billsRepo.deleteDraftBill(tx, billId),
    );

    revalidatePath("/dashboard/bills");
    return { success: true, billNumber, message: `Bill ${billNumber} deleted` };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}
