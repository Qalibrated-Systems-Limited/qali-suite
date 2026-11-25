"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { billTechnicalJob, invoiceShopOrder } from "../financeHandoff";

/**
 * Finance's side of the hand-offs from other modules, and the counts behind
 * the Processes page. See app/db/financeHandoff.ts.
 */

const BILLERS = INVOICE_WRITE_ROLES as unknown as string[];
const actorOf = (u: { id?: string | null; name?: string | null; role?: string | null }) => ({
  id: u.id ? String(u.id) : null,
  name: u.name ?? null,
  role: u.role ?? null,
});

export async function getBillingCustomers() {
  try {
    return await withAuthorizedTenant(BILLERS, async (tx) =>
      (await tx.execute(sql`
        SELECT id::text AS id, COALESCE(display_name, name) AS name
          FROM parties WHERE is_customer AND COALESCE(is_active, true) ORDER BY 2 LIMIT 2000
      `)) as unknown as Array<{ id: string; name: string }>,
    );
  } catch {
    return [];
  }
}

export async function billTechnicalJobPg(input: {
  kind: "calibration" | "inspection";
  id: string;
  customerId: string;
  amount: number;
  taxRate: number;
  description?: string;
}) {
  if (!["calibration", "inspection"].includes(input?.kind)) return { success: false, error: "Unknown job type." };
  try {
    const inv = await withAuthorizedTenant(BILLERS, (tx, { user, companyId }) =>
      billTechnicalJob(tx, companyId, { ...input, amount: Number(input.amount), taxRate: Number(input.taxRate) || 0 }, actorOf(user)),
    );
    revalidatePath(input.kind === "calibration" ? "/dashboard/calibration" : "/dashboard/inspection");
    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/finance/processes");
    return { success: true, invoiceId: inv.id, message: `Draft invoice ${inv.invoiceNumber} raised — review and send it from Invoices.` };
  } catch (error) {
    return { success: false, error: userMessage(error, "Could not raise the invoice.") };
  }
}

export async function invoiceShopOrderPg(orderId: string) {
  try {
    const inv = await withAuthorizedTenant(BILLERS, (tx, { user, companyId }) =>
      invoiceShopOrder(tx, companyId, orderId, actorOf(user)),
    );
    revalidatePath("/dashboard/shop");
    revalidatePath("/dashboard/invoices");
    return { success: true, invoiceId: inv.id, message: `Draft invoice ${inv.invoiceNumber} raised from the order.` };
  } catch (error) {
    return { success: false, error: userMessage(error, "Could not raise the invoice.") };
  }
}

/** What is waiting at each step of each process. A count that fails is null. */
export async function getProcessCounts(): Promise<Record<string, number | null>> {
  const queries: Record<string, ReturnType<typeof sql>> = {
    quotesOpen: sql`SELECT count(*) FROM quotes WHERE status IN ('draft','sent','accepted')`,
    ordersToInvoice: sql`SELECT count(*) FROM sales_orders WHERE status = 'confirmed'`,
    invoicesDraft: sql`SELECT count(*) FROM invoices WHERE status = 'draft'`,
    invoicesUnpaid: sql`SELECT count(*) FROM invoices WHERE status IN ('sent','completed') AND payment_status IN ('unpaid','partial')`,
    creditNotesDraft: sql`SELECT count(*) FROM credit_notes WHERE status = 'draft'`,
    posOpen: sql`SELECT count(*) FROM purchase_orders WHERE status IN ('sent','confirmed')`,
    grnsPending: sql`SELECT count(*) FROM goods_receipts WHERE status = 'pending_acceptance'`,
    billsToApprove: sql`SELECT count(*) FROM bills WHERE status IN ('draft','submitted')`,
    billsUnpaid: sql`SELECT count(*) FROM bill_aging WHERE balance > 0`,
    grirOpen: sql`SELECT count(DISTINCT purchase_order_id) FROM gr_ir_open_items WHERE uninvoiced_quantity > 0`,
    claimsToApprove: sql`SELECT count(*) FROM employee_claims WHERE status = 'submitted'`,
    claimsToPay: sql`SELECT count(*) FROM employee_claims WHERE status IN ('approved','pending_payment')`,
    advancesToReturn: sql`SELECT count(*) FROM employee_claims WHERE status = 'pending_return'`,
    expensesDraft: sql`SELECT count(*) FROM expenses WHERE status = 'draft'`,
    countsInReview: sql`SELECT count(*) FROM stock_counts WHERE status = 'review'`,
    stockApprovals: sql`SELECT count(*) FROM approval_requests WHERE status = 'submitted' AND type::text IN ('stock_adjustment','stock_writeoff','stock_valuation')`,
    ncrsOpen: sql`SELECT count(*) FROM nonconformances WHERE status IN ('open','disposition_proposed','authorized')`,
    jobsToBill: sql`SELECT (SELECT count(*) FROM calibration_jobs WHERE status IN ('approved','completed') AND billing_status = 'pending')
                        + (SELECT count(*) FROM inspections WHERE status IN ('approved','completed') AND billing_status = 'pending')`,
    shopToInvoice: sql`SELECT count(*) FROM shop_orders WHERE status IN ('paid','shipped','delivered') AND invoice_id IS NULL`,
    cashReqToDecide: sql`SELECT count(*) FROM project_cash_requisitions WHERE status = 'submitted'`,
    cashReqToFund: sql`SELECT count(*) FROM project_cash_requisitions WHERE status = 'approved'`,
    payrollDraft: sql`SELECT count(*) FROM payroll_runs WHERE status IN ('draft','processing')`,
    payrollReview: sql`SELECT count(*) FROM payroll_runs WHERE status = 'review'`,
    payrollApproved: sql`SELECT count(*) FROM payroll_runs WHERE status = 'approved'`,
    bankUnallocated: sql`SELECT count(*) FROM bank_feed_lines WHERE status = 'unallocated'`,
    periodsOpen: sql`SELECT count(*) FROM fiscal_periods WHERE status::text = 'open' AND end_date < CURRENT_DATE`,
  };
  return withAuthorizedTenant([], async (tx) => {
    const out: Record<string, number | null> = {};
    for (const [key, q] of Object.entries(queries)) {
      try {
        // A savepoint each, so one missing table does not spoil the rest.
        out[key] = await tx.transaction(async (sp) => {
          const [r] = (await sp.execute(q)) as unknown as Array<Record<string, unknown>>;
          return Number(Object.values(r ?? {})[0] ?? 0);
        });
      } catch {
        out[key] = null;
      }
    }
    return out;
  });
}
