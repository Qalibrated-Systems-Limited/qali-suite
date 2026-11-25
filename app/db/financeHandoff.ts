import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./client";
import { createExpenseDraft, deleteDraftExpense } from "./repositories/expenses";
import { createInvoice } from "./repositories/invoices";

/**
 * Where other modules hand money to finance (other_modules_hand_their_money_to_finance).
 * Each hand-off raises a DRAFT — an expense or an invoice — so finance reviews
 * and posts it through the normal path, with its own controls. Not a server
 * action module: called from inside the owning module's transaction.
 */

const money = (n: number) => (Math.round(n * 10000) / 10000).toFixed(4);

/** An expense account by name, falling back to Miscellaneous. */
async function expenseAccount(tx: Tx, names: string[]) {
  for (const n of [...names, "Miscellaneous Expenses"]) {
    const [a] = (await tx.execute(sql`
      SELECT id::text AS id FROM accounts
       WHERE account_type = 'expense' AND COALESCE(can_post, true) AND account_name ILIKE ${n + "%"}
       ORDER BY account_code LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    if (a) return a.id;
  }
  return null;
}

/**
 * Training with a cost → a draft expense in the Training account, raised
 * once; a changed cost refreshes a draft that is still a draft. A posted one
 * is in the books and is left alone. Returns a sentence for the user.
 */
export async function trainingToExpense(
  tx: Tx,
  companyId: string,
  trainingId: string,
  createdById: string | null,
): Promise<string> {
  const [t] = (await tx.execute(sql`
    SELECT t.id, t.title, t.provider, t.cost::float8 AS cost, t.expense_id::text AS "expenseId",
           COALESCE(t.completed_on, t.start_date, CURRENT_DATE)::text AS day,
           e.status::text AS "expenseStatus", emp.full_name AS employee
      FROM hr_training_records t
      LEFT JOIN expenses e ON e.id = t.expense_id
      LEFT JOIN LATERAL (SELECT COALESCE(NULLIF(full_name, ''), concat_ws(' ', first_name, last_name)) AS full_name FROM employees WHERE id = t.employee_id) emp ON true
     WHERE t.id = ${trainingId}::uuid
  `)) as unknown as Array<{
    id: string; title: string; provider: string | null; cost: number | null; expenseId: string | null;
    day: string; expenseStatus: string | null; employee: string | null;
  }>;
  if (!t) return "";
  const cost = Number(t.cost ?? 0);

  if (t.expenseId && t.expenseStatus && t.expenseStatus !== "draft") return "";
  if (t.expenseId && t.expenseStatus === "draft") {
    await tx.execute(sql`UPDATE hr_training_records SET expense_id = NULL WHERE id = ${t.id}::uuid`);
    await deleteDraftExpense(tx, t.expenseId);
  }
  if (!(cost > 0)) return "";

  const accountId = await expenseAccount(tx, ["Training"]);
  if (!accountId) return " The cost could not go to finance: there is no expense account for training.";
  const expense = await createExpenseDraft(tx, {
    companyId,
    expenseDate: t.day.slice(0, 10),
    category: "training",
    accountId,
    amount: money(cost) as never,
    payeeName: t.provider || "Training provider",
    description: `Training: ${t.title}${t.employee ? ` — ${t.employee}` : ""}`,
    reference: "HR training",
    createdById,
  } as never);
  await tx.execute(sql`UPDATE hr_training_records SET expense_id = ${expense.id}::uuid WHERE id = ${t.id}::uuid`);
  return ` Its cost is a draft expense (${expense.expenseNumber}) for finance to post.`;
}

/** When training goes, its draft expense goes with it; a posted one stays. */
export async function releaseTrainingExpense(tx: Tx, expenseId: string | null) {
  if (!expenseId) return;
  const [e] = (await tx.execute(sql`SELECT status::text AS s FROM expenses WHERE id = ${expenseId}::uuid`)) as unknown as Array<{ s: string }>;
  if (e?.s === "draft") await deleteDraftExpense(tx, expenseId);
}

type Actor = { id?: string | null; name?: string | null; role?: string | null };

/**
 * A finished calibration job or inspection → a draft invoice to the client,
 * one service line. Once: the job then reads `invoiced` and links the invoice.
 */
export async function billTechnicalJob(
  tx: Tx,
  companyId: string,
  input: { kind: "calibration" | "inspection"; id: string; customerId: string; amount: number; taxRate: number; description?: string },
  actor: Actor,
) {
  const table = input.kind === "calibration" ? sql`calibration_jobs` : sql`inspections`;
  const numberCol = input.kind === "calibration" ? sql`job_number` : sql`inspection_number`;
  const what = input.kind === "calibration" ? sql`service_type` : sql`type`;
  const [job] = (await tx.execute(sql`
    SELECT ${numberCol} AS number, ${what} AS what, billing_status AS billing, invoice_id::text AS "invoiceId",
           status, client_name AS client, project_id::text AS "projectId"
      FROM ${table} WHERE id = ${input.id}::uuid
  `)) as unknown as Array<{ number: string; what: string; billing: string; invoiceId: string | null; status: string; client: string; projectId: string | null }>;
  if (!job) throw new Error("Job not found.");
  if (job.invoiceId || job.billing === "invoiced") throw new Error(`${job.number} has already been invoiced.`);
  if (!(input.amount > 0)) throw new Error("Enter the amount to bill.");
  const [cust] = (await tx.execute(sql`SELECT 1 FROM parties WHERE id = ${input.customerId}::uuid AND is_customer`)) as unknown as unknown[];
  if (!cust) throw new Error("Choose a customer.");

  const today = new Date().toISOString().slice(0, 10);
  const invoice = await createInvoice(tx, {
    companyId,
    customerId: input.customerId,
    invoiceDate: today,
    title: `${input.kind === "calibration" ? "Calibration" : "Inspection"} ${job.number}`,
    notes: `Raised from ${job.number}${job.client ? ` for ${job.client}` : ""}.`,
    lines: [
      {
        itemType: "service",
        serviceCategory: input.kind === "calibration" ? "maintenance" : "consultation",
        quantity: "1",
        unitPrice: money(input.amount),
        unit: "job",
        description: input.description?.trim() || `${job.what} — ${job.number}`,
        taxRate: money(input.taxRate),
      },
    ],
    createdById: actor.id ?? null,
    createdByName: actor.name ?? null,
    createdByRole: actor.role ?? null,
  } as never);
  await tx.execute(sql`
    UPDATE ${table} SET billing_status = 'invoiced', invoice_id = ${String((invoice as { id: string }).id)}::uuid, updated_at = now()
     WHERE id = ${input.id}::uuid
  `);
  return invoice as { id: string; invoiceNumber: string };
}

/** A paid web-shop order → a draft invoice to its customer, from its lines. */
export async function invoiceShopOrder(tx: Tx, companyId: string, orderId: string, actor: Actor) {
  const [o] = (await tx.execute(sql`
    SELECT order_number AS number, customer_party_id::text AS "customerId", customer_name AS customer,
           status, invoice_id::text AS "invoiceId"
      FROM shop_orders WHERE id = ${orderId}::uuid
  `)) as unknown as Array<{ number: string; customerId: string | null; customer: string; status: string; invoiceId: string | null }>;
  if (!o) throw new Error("Order not found.");
  if (o.invoiceId) throw new Error(`${o.number} has already been invoiced.`);
  if (o.status === "cancelled" || o.status === "awaiting_payment") {
    throw new Error("Invoice an order once it is paid.");
  }
  if (!o.customerId) throw new Error(`${o.number} has no customer record. Link the customer to a customer account first.`);
  const lines = (await tx.execute(sql`
    SELECT product_id::text AS "productId", description, qty::float8 AS qty, unit_price::float8 AS price
      FROM shop_order_lines WHERE order_id = ${orderId}::uuid
  `)) as unknown as Array<{ productId: string | null; description: string | null; qty: number; price: number }>;
  if (!lines.length) throw new Error(`${o.number} has no lines to invoice.`);
  const invoice = await createInvoice(tx, {
    companyId,
    customerId: o.customerId,
    invoiceDate: new Date().toISOString().slice(0, 10),
    title: `Web order ${o.number}`,
    notes: `Raised from online shop order ${o.number}.`,
    lines: lines.map((l) => ({
      productId: l.productId,
      itemType: l.productId ? "product" : "service",
      quantity: money(l.qty),
      unitPrice: money(l.price),
      description: l.description,
    })),
    createdById: actor.id ?? null,
    createdByName: actor.name ?? null,
    createdByRole: actor.role ?? null,
  } as never);
  await tx.execute(sql`UPDATE shop_orders SET invoice_id = ${String((invoice as { id: string }).id)}::uuid, updated_at = now() WHERE id = ${orderId}::uuid`);
  return invoice as { id: string; invoiceNumber: string };
}
