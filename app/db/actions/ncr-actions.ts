"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import type { Tx } from "../client";
import {
  NCR_RAISE_ROLES,
  NCR_PROPOSE_ROLES,
  NCR_AUTHORIZE_ROLES,
} from "@/lib/utils/role-gates";
import * as nonconformance from "../repositories/nonconformance";
import * as accountsRepo from "../repositories/accounts";
import { sql } from "drizzle-orm";
import { ncrReasonLabel } from "@/lib/ncr/reasons";
import { sendSupplierDiscrepancyEmail } from "@/lib/email";
import {
  nonconformanceSchema,
  toNonconformanceInput,
} from "../validation/procurement";

/**
 * Nonconformance actions on Postgres (§9G, SOP §10.6).
 *
 * The interesting one is `executeNonconformanceDispositionPg`, because in the
 * Mongo module the equivalent posts nothing at all: closeNCR moves stock out
 * of HOLD and carries a comment saying journal-entry posting for return and
 * scrap is "intentionally out of scope here". Goods are written off, they
 * physically leave, and their value stays on the balance sheet.
 *
 * Three hands, and the schema holds them apart: raise, propose, authorise. The
 * role gates say what kind of person may do each; the CHECK constraints in
 * 0051 say that they must be three different people.
 */

export type ActionResult =
  | {
      success: true;
      nonconformanceId?: string;
      ncrNumber?: string;
      journalEntryId?: string | null;
      message?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function revalidateNcr(nonconformanceId?: string, extra: string[] = []) {
  revalidatePath("/dashboard/ncr");
  if (nonconformanceId) revalidatePath(`/dashboard/ncr/${nonconformanceId}`);
  for (const path of extra) revalidatePath(path);
}

/**
 * The three accounts a disposition can touch.
 *
 * Scrapped value lands in Inventory Adjustments (5300) — an expense the chart
 * already provisions, described as the home for stock movements with no source
 * document, which a write-off is. It is deliberately not Inventory: crediting
 * the asset is what the entry DOES, and the debit has to leave the balance
 * sheet or nothing has been written off.
 */
async function resolveDispositionAccounts(tx: Tx) {
  const [inventory, grni, writeOff] = await Promise.all([
    accountsRepo.getSystemAccount(tx, "inventory"),
    accountsRepo.getSystemAccount(tx, "grni"),
    accountsRepo.getSystemAccount(tx, "inventory_adjustments"),
  ]);
  if (!inventory || !grni || !writeOff) {
    const missing = [
      !inventory && "Inventory",
      !grni && "GR/IR Clearing",
      !writeOff && "Inventory Adjustments",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Cannot carry out this disposition: the ${missing} account is not configured for this company.`,
    );
  }
  return {
    inventoryAccountId: inventory.id,
    grniAccountId: grni.id,
    writeOffAccountId: writeOff.id,
  };
}

export async function createNonconformancePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("data") ?? "{}"));
  } catch {
    return { success: false, error: "Could not read the form data" };
  }
  const parsed = nonconformanceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const ncr = await withAuthorizedTenant(
      [...NCR_RAISE_ROLES],
      (tx, { user, companyId }) =>
        nonconformance.createNonconformance(tx, {
          companyId,
          ...toNonconformanceInput(parsed.data),
          createdById: user.id,
          createdByName: user.name,
        }),
    );

    const forwarded = ncr.supplierId || ncr.supplierName ? await forwardToSupplier(ncr.id) : null;
    revalidateNcr();
    return {
      success: true,
      nonconformanceId: ncr.id,
      ncrNumber: ncr.ncrNumber,
      message: `Nonconformance ${ncr.ncrNumber} raised${forwardedText(forwarded)}`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not raise the nonconformance.") };
  }
}

/**
 * Raises one from a receipt's discrepant lines.
 *
 * The lines it covers are named by id. Mongo copies the product id and matches
 * back through a Map, which resolves against the wrong line whenever a delivery
 * carries the same product twice — two pallets in different condition, which is
 * the reason for the report in the first place.
 */
export async function createNonconformanceFromReceiptPg(
  goodsReceiptId: string,
  input: { title?: string | null; description?: string | null; requiresCar?: boolean; reasonCode?: string | null } = {},
): Promise<ActionResult> {
  try {
    const ncr = await withAuthorizedTenant([...NCR_RAISE_ROLES], (tx, { user }) =>
      nonconformance.createFromGoodsReceipt(tx, goodsReceiptId, {
        ...input,
        createdById: user.id,
        createdByName: user.name,
      }),
    );

    const forwarded = ncr.supplierId || ncr.supplierName ? await forwardToSupplier(ncr.id) : null;
    revalidateNcr(undefined, [`/dashboard/grn/${goodsReceiptId}`]);
    return {
      success: true,
      nonconformanceId: ncr.id,
      ncrNumber: ncr.ncrNumber,
      message: `Nonconformance ${ncr.ncrNumber} raised against the receipt${forwardedText(forwarded)}`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not raise the nonconformance.") };
  }
}

export async function proposeDispositionPg(
  nonconformanceId: string,
  dispositionType: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const ncr = await withAuthorizedTenant([...NCR_PROPOSE_ROLES], (tx, { user }) =>
      nonconformance.proposeDisposition(
        tx,
        nonconformanceId,
        dispositionType,
        reason,
        user.id,
        user.name,
      ),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, ncrNumber: ncr.ncrNumber, message: "Disposition proposed" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not propose the disposition.") };
  }
}

/** SOP §10.6: the Managing Director, or delegated authority. Never the proposer. */
export async function authorizeDispositionPg(
  nonconformanceId: string,
  notes?: string | null,
): Promise<ActionResult> {
  try {
    const ncr = await withAuthorizedTenant([...NCR_AUTHORIZE_ROLES], (tx, { user }) =>
      nonconformance.authorizeDisposition(
        tx,
        nonconformanceId,
        user.id,
        user.name,
        notes ?? null,
      ),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, ncrNumber: ncr.ncrNumber, message: "Disposition authorised" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not authorise the disposition.") };
  }
}

/**
 * The disposition is carried out: the goods move, and so does the ledger.
 *
 * Closing means the decision has been EXECUTED. That is why 'repair' releases
 * the goods here rather than leaving them held "until the repair workflow
 * completes" — there is no such workflow, so in Mongo the stock is held
 * indefinitely. An unfinished repair is a nonconformance that is not closed yet.
 */
export async function executeNonconformanceDispositionPg(
  nonconformanceId: string,
  notes?: string | null,
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(
      [...NCR_PROPOSE_ROLES],
      async (tx, { user }) => {
        // HANDLED BEFORE CLOSED: containment, root cause, corrective action,
        // and — when a supplier is involved — the notice to them.
        const missing = await nonconformance.closeBlockers(tx, nonconformanceId);
        if (missing.length) {
          throw new Error(`Before closing, record ${missing.join(", ")}.`);
        }
        const accounts = await resolveDispositionAccounts(tx);
        return nonconformance.executeDisposition(tx, nonconformanceId, {
          ...accounts,
          executedById: user.id,
          executedByName: user.name,
          notes: notes ?? null,
        });
      },
    );

    revalidateNcr(nonconformanceId, [
      "/dashboard/stocks",
      "/dashboard/journal",
      "/dashboard/grn",
    ]);
    return {
      success: true,
      ncrNumber: result.nonconformance.ncrNumber,
      journalEntryId: result.entry?.id ?? null,
      message: result.entry
        ? `${result.nonconformance.ncrNumber} closed and posted`
        : `${result.nonconformance.ncrNumber} closed — the goods went back, so nothing was posted`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not carry out the disposition.") };
  }
}

export async function cancelNonconformancePg(
  nonconformanceId: string,
  reason: string,
): Promise<ActionResult> {
  if (!reason?.trim()) {
    return { success: false, error: "Cancelling a nonconformance needs a reason." };
  }

  try {
    await withAuthorizedTenant([...NCR_PROPOSE_ROLES], (tx, { user }) =>
      nonconformance.cancelNonconformance(
        tx,
        nonconformanceId,
        reason,
        user.id,
        user.name,
      ),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, message: "Nonconformance cancelled" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not cancel the nonconformance.") };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listNonconformancesPg(
  filters: nonconformance.ListNonconformancesFilters = {},
  page = 1,
  pageSize = 20,
) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.listNonconformances(tx, filters, page, pageSize),
  );
}

export async function countNonconformancesPg(
  filters: nonconformance.ListNonconformancesFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.countNonconformances(tx, filters),
  );
}

export async function getNonconformanceDetailPg(nonconformanceId: string) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.getNonconformanceDetail(tx, nonconformanceId),
  );
}

/** The report as the detail page renders it. */
export async function getNonconformanceForDisplayPg(nonconformanceId: string) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.getNonconformanceForDisplay(tx, nonconformanceId),
  );
}

/** The list rows, in the shape the NCR index reads. */
export async function listNonconformancesForDisplayPg(
  filters: nonconformance.ListNonconformancesFilters = {},
  page = 1,
  pageSize = 20,
) {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.listNonconformancesForDisplay(tx, filters, page, pageSize),
  );
}

/**
 * Nonconformances waiting for the MD's decision — for the approvals queue.
 *
 * The approvals dashboard counted these in Mongo. Once the register moved,
 * that collection stopped being written to, so the queue reported an empty
 * list however many were waiting — the same failure the HR port produced with
 * leave and loans, and the reason `getPendingLoans` delegates to Postgres
 * rather than querying a model.
 *
 * The row shape is the queue's, not the schema's.
 */
export async function listNonconformancesAwaitingAuthorisationPg(limit = 50) {
  const rows = await withAuthorizedTenant([], (tx) =>
    nonconformance.listNonconformances(
      tx,
      { status: "disposition_proposed" },
      1,
      Math.min(limit, 200),
    ),
  );

  return rows.map((r: Record<string, any>) => ({
    _id: r.id,
    ref: r.ncr_number,
    title: r.title || "—",
    subtitle: r.disposition_type || r.category || "—",
    submittedAt: r.proposed_at || r.updated_at,
    submittedBy: r.proposed_by_name || "—",
    href: `/dashboard/ncr/${r.id}`,
    meta: r.source_reference || null,
  }));
}

/** How many are waiting, for the badge beside the queue. */
export async function countNonconformancesAwaitingAuthorisationPg() {
  return withAuthorizedTenant([], (tx) =>
    nonconformance.countNonconformances(tx, { status: "disposition_proposed" }),
  );
}

const PAGE_SIZE = 20;

/** The NCR index's query, in the shape the page destructures. */
export async function getNonconformancesPagePg(
  opts: { page?: number; status?: string; category?: string; search?: string } = {},
) {
  const page = Math.max(Number(opts.page) || 1, 1);
  const filters: nonconformance.ListNonconformancesFilters = {
    status: opts.status || null,
    category: opts.category || null,
    search: opts.search || null,
  };

  const { ncrs, total } = await withAuthorizedTenant([], async (tx) => ({
    ncrs: await nonconformance.listNonconformancesForDisplay(tx, filters, page, PAGE_SIZE),
    total: await nonconformance.countNonconformances(tx, filters),
  }));

  return {
    ncrs,
    pagination: { page, total, totalPages: Math.ceil(total / PAGE_SIZE) },
  };
}

/** The stat cards, keyed as the index reads them. */
export async function getNonconformanceStatsForDisplayPg() {
  const raw = (await withAuthorizedTenant([], (tx) =>
    nonconformance.getNonconformanceStats(tx),
  )) as Record<string, string | number> | null;

  const n = (k: string) => Number(raw?.[k] ?? 0);
  return {
    total: n("total"),
    open: n("open"),
    disposition_proposed: n("awaiting_authorisation"),
    authorized: n("awaiting_execution"),
    closed: n("closed"),
    critical: n("critical"),
    requiring_car: n("requiring_car"),
    affectedValue: Number(raw?.affected_value ?? 0),
  };
}

export async function getNonconformanceStatsPg() {
  return withAuthorizedTenant([], (tx) => nonconformance.getNonconformanceStats(tx));
}


// ── Handling and the supplier (ncrs_carry_a_reason_a_handling_record_and_a_supplier_notice)

const HANDLING_ROLES = Array.from(
  new Set([...NCR_RAISE_ROLES, ...NCR_PROPOSE_ROLES, ...NCR_AUTHORIZE_ROLES]),
) as string[];

function forwardedText(f: { ok: boolean; to?: string; error?: string } | null) {
  if (!f) return "";
  return f.ok ? ` and forwarded to the supplier (${f.to})` : ` — not yet sent to the supplier: ${f.error}`;
}

/**
 * Email the supplier the discrepancy and record that it went. Used straight
 * after raising, and from the NCR page. Never throws: a mail that could not go
 * leaves the NCR showing "supplier not yet told", with a button to retry or
 * record another way.
 */
async function forwardToSupplier(nonconformanceId: string, message = "", toOverride = "") {
  try {
    return await withAuthorizedTenant(HANDLING_ROLES, async (tx, { user }) => {
      const c = await nonconformance.supplierContact(tx, nonconformanceId);
      if (!c) return { ok: false, error: "NCR not found" };
      const to = (toOverride || c.email || "").trim();
      if (!to) return { ok: false, error: "the supplier has no email address on file" };
      const [co] = (await tx.execute(sql`
        SELECT c.name FROM companies c WHERE c.id = NULLIF(current_setting('app.company_id', true), '')::uuid
      `)) as unknown as Array<{ name: string }>;
      const reasonLabel = ncrReasonLabel(c.reasonCode);
      await sendSupplierDiscrepancyEmail({
        to,
        replyTo: (user as { email?: string }).email || undefined,
        supplierName: c.partyName || c.supplierName || "Supplier",
        senderCompany: co?.name,
        ncrNumber: String(c.ncrNumber),
        reasonLabel,
        reference: c.sourceReference || "",
        title: String(c.title ?? ""),
        message: message || String(c.description ?? ""),
        lines: c.lines,
      });
      await nonconformance.recordSupplierNotice(tx, nonconformanceId, {
        to,
        via: "email",
        text: message || String(c.description ?? ""),
        byName: user.name || "Staff",
      });
      return { ok: true, to };
    });
  } catch (err) {
    return { ok: false, error: userMessage(err, "the email could not be sent") };
  }
}

export async function recordNcrHandlingPg(
  nonconformanceId: string,
  step: "containment" | "root_cause" | "corrective",
  text: string,
): Promise<ActionResult> {
  if (!["containment", "root_cause", "corrective"].includes(step)) {
    return { success: false, error: "Unknown step." };
  }
  const t = String(text ?? "").trim();
  if (t.length < 5) return { success: false, error: "Write a sentence or two — what was done, by whom." };
  try {
    const r = await withAuthorizedTenant(HANDLING_ROLES, (tx, { user }) =>
      nonconformance.recordHandling(tx, nonconformanceId, step, t.slice(0, 4000), user.name || "Staff"),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, ncrNumber: r.ncrNumber, message: "Recorded" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record it.") };
  }
}

/**
 * Tell the supplier. By email (sent from here), or record that they were told
 * another way — a call, a letter, at the gate — with what was said.
 */
export async function notifyNcrSupplierPg(
  nonconformanceId: string,
  input: { via: "email" | "phone" | "letter" | "in_person"; to?: string; message?: string },
): Promise<ActionResult> {
  const via = input?.via;
  if (!["email", "phone", "letter", "in_person"].includes(via)) return { success: false, error: "Choose how they were told." };
  const message = String(input?.message ?? "").trim().slice(0, 4000);
  if (via === "email") {
    const f = await forwardToSupplier(nonconformanceId, message, String(input?.to ?? ""));
    revalidateNcr(nonconformanceId);
    return f.ok
      ? { success: true, message: `Sent to ${f.to}` }
      : { success: false, error: `Not sent: ${f.error}.` };
  }
  if (!message) return { success: false, error: "Say what the supplier was told." };
  const to = String(input?.to ?? "").trim();
  if (!to) return { success: false, error: "Say who at the supplier was told." };
  try {
    await withAuthorizedTenant(HANDLING_ROLES, (tx, { user }) =>
      nonconformance.recordSupplierNotice(tx, nonconformanceId, { to, via, text: message, byName: user.name || "Staff" }),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, message: "Recorded that the supplier was told" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record it.") };
  }
}

export async function recordNcrSupplierResponsePg(nonconformanceId: string, text: string): Promise<ActionResult> {
  const t = String(text ?? "").trim();
  if (!t) return { success: false, error: "What did the supplier answer?" };
  try {
    await withAuthorizedTenant(HANDLING_ROLES, (tx) =>
      nonconformance.recordSupplierResponse(tx, nonconformanceId, t.slice(0, 4000)),
    );
    revalidateNcr(nonconformanceId);
    return { success: true, message: "Supplier's answer recorded" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not record it.") };
  }
}

/** Suppliers, products and recent receipts, for the raise form. */
export async function getNcrRaiseOptionsPg() {
  return withAuthorizedTenant([...NCR_RAISE_ROLES], async (tx) => {
    const suppliers = (await tx.execute(sql`
      SELECT id::text AS id, COALESCE(display_name, name) AS name, email
        FROM parties WHERE is_supplier AND COALESCE(is_active, true) ORDER BY 2 LIMIT 1000
    `)) as unknown as Array<{ id: string; name: string; email: string | null }>;
    const products = (await tx.execute(sql`
      SELECT id::text AS id, name, sku, unit, cost_price::float8 AS cost
        FROM products ORDER BY name LIMIT 2000
    `)) as unknown as Array<{ id: string; name: string; sku: string; unit: string; cost: number }>;
    const receipts = (await tx.execute(sql`
      SELECT g.id::text AS id, g.grn_number AS number, g.supplier_name AS supplier, g.status
        FROM goods_receipts g ORDER BY g.created_at DESC LIMIT 50
    `)) as unknown as Array<{ id: string; number: string; supplier: string | null; status: string }>;
    return { suppliers, products, receipts };
  });
}
