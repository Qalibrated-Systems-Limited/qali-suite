"use server";

import { revalidatePath } from "next/cache";

import JournalEntry from "@/app/models/JournalEntry";
import Account from "@/app/models/account";
import Invoice from "@/app/models/invoice";
import Bill from "@/app/models/bill";
import Party from "@/app/models/parties";
import ErpCounter from "@/app/models/erp-counter";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, buildTenantMatch } from "@/lib/utils/tenant-utils";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import { roleAllowed } from "@/lib/permissions";

// Only finance roles may book opening balances — same gate as manual journals.
const ALLOWED_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ============================================
// POST OPENING BALANCES
// ============================================
// Takes a cutover date + per-account debit/credit figures (the trial balance
// as of that date) and posts ONE balanced `opening_balance` journal entry.
// Whatever the figures don't balance to is plugged into Opening Balance Equity
// — the "to-be-sorted drawer" the user later reclassifies into real equity.
export async function postOpeningBalances({ entryDate, lines } = {}) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return { success: false, error: "You don't have permission to book opening balances." };
  }

  try {
    await requirePlanAccess("finance");

    if (!entryDate) return { success: false, error: "A cutover date is required." };
    const date = new Date(entryDate);
    if (Number.isNaN(date.getTime())) {
      return { success: false, error: "The cutover date is invalid." };
    }

    // Keep only rows with an actual figure entered.
    const cleaned = (lines || [])
      .map((l) => ({
        accountId: String(l.accountId || ""),
        debit: round2(l.debit),
        credit: round2(l.credit),
      }))
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));

    if (cleaned.length === 0) {
      return { success: false, error: "Enter at least one opening balance." };
    }
    if (cleaned.some((l) => l.debit > 0 && l.credit > 0)) {
      return { success: false, error: "A line cannot have both a debit and a credit." };
    }

    // Booking opening balances twice would double the books. Block if a
    // non-reversed opening LUMP entry already exists; the user must reverse it
    // first. The lump is identified by having NO related invoice/bill — that
    // distinguishes it from opening AR/AP documents (which also use entryType
    // "opening_balance" but always set relatedDocuments).
    const existing = await JournalEntry.findOne({
      companyId,
      entryType: "opening_balance",
      status: { $ne: "reversed" },
      "relatedDocuments.invoiceId": { $exists: false },
      "relatedDocuments.billId": { $exists: false },
    })
      .select("entryNumber")
      .lean();
    if (existing) {
      return {
        success: false,
        error: `Opening balances were already posted (${existing.entryNumber}). Reverse that entry before re-entering.`,
      };
    }

    // Resolve the entered accounts (tenant-scoped, postable only).
    const ids = cleaned.map((l) => l.accountId);
    const accounts = await Account.find({
      _id: { $in: ids },
      companyId,
      canPost: true,
    }).lean();
    const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

    const jeLines = [];
    for (const l of cleaned) {
      const a = byId.get(l.accountId);
      if (!a) return { success: false, error: "One of the selected accounts could not be found." };
      jeLines.push({
        accountId: a._id,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        debit: l.debit,
        credit: l.credit,
        description: "Opening balance",
      });
    }

    // Plug the difference into Opening Balance Equity so the entry balances.
    const totalDebit = round2(jeLines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(jeLines.reduce((s, l) => s + l.credit, 0));
    const diff = round2(totalDebit - totalCredit); // >0 → needs a credit plug
    let openingBalanceEquity = 0;

    if (Math.abs(diff) >= 0.01) {
      const obe = await Account.findOne({
        companyId,
        systemAccount: "opening_balance_equity",
      }).lean();
      if (!obe) {
        return {
          success: false,
          error: "Opening Balance Equity account is not set up for this company. Contact support.",
        };
      }
      jeLines.push({
        accountId: obe._id,
        accountCode: obe.accountCode,
        accountName: obe.accountName,
        accountType: obe.accountType,
        debit: diff > 0 ? 0 : -diff,
        credit: diff > 0 ? diff : 0,
        description: "Opening balance — to be reclassified to equity",
      });
      // OBE is credit-normal (equity): its resulting balance equals `diff`.
      openingBalanceEquity = diff;
    }

    if (jeLines.length < 2) {
      return { success: false, error: "Opening balances need at least two accounts." };
    }

    const entryNumber = await generateUniqueEntryNumber("OB", companyId);
    const entry = new JournalEntry({
      companyId,
      entryNumber,
      entryDate: date,
      entryType: "opening_balance",
      description: "Opening balances",
      lines: jeLines,
      status: "draft",
      createdBy: { name: user.name, id: user.id },
      fiscalYear: date.getFullYear(),
      fiscalMonth: date.getMonth() + 1,
    });
    await entry.save();
    await entry.post({ name: user.name, id: user.id });

    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    revalidatePath("/dashboard/reports/balance-sheet");

    return {
      success: true,
      entryNumber: entry.entryNumber,
      openingBalanceEquity, // credit-normal; non-zero means "still to reclassify"
    };
  } catch (error) {
    console.error("Post opening balances error:", error);
    return { success: false, error: error.message || "Failed to post opening balances." };
  }
}

// ============================================
// OPENING AR / AP — Xero-style conversion documents
// ============================================
// Outstanding customer invoices and supplier bills as of the conversion date
// are entered one-by-one so each control account (AR/AP) is built up from its
// subledger. They post ONLY against Opening Balance Equity — never revenue,
// VAT, COGS, inventory or WHT — see invoice.completeOpening / bill.approveOpening.

// True once the company has posted any REAL trading activity. All opening
// entries (lump, AR, AP) share entryType "opening_balance" and so are excluded;
// reversal JEs carry originalEntryId and are excluded too. Once this is true,
// opening-balance entry is locked (the cutover is over).
async function hasRealTransactions(companyId, isSuperAdmin) {
  const match = buildTenantMatch(companyId, isSuperAdmin);
  return JournalEntry.exists({
    ...match,
    status: "posted",
    entryType: { $nin: ["opening_balance"] },
    originalEntryId: { $exists: false },
  });
}

// Shared guard for every opening-balance write: finance role + plan access +
// not yet live. Returns { ok:false, error } or { ok:true, ctx }.
async function guardOpeningEntry() {
  await dbConnect();
  const { user, companyId, isSuperAdmin } = await getTenantContext();

  if (!user || !roleAllowed(user.role, ALLOWED_ROLES)) {
    return { ok: false, error: "You don't have permission to book opening balances." };
  }
  try {
    await requirePlanAccess("finance");
  } catch (e) {
    return { ok: false, error: e.message || "Your plan does not include this feature." };
  }
  if (await hasRealTransactions(companyId, isSuperAdmin)) {
    return {
      ok: false,
      error: "Opening balances are locked — real transactions already exist for this company.",
    };
  }
  return { ok: true, user, companyId, isSuperAdmin };
}

// Set / update the company conversion (cutover) date.
export async function setConversionDate({ date } = {}) {
  const guard = await guardOpeningEntry();
  if (!guard.ok) return { success: false, error: guard.error };
  const { user, companyId } = guard;

  if (!date) return { success: false, error: "A conversion date is required." };
  const conv = new Date(date);
  if (Number.isNaN(conv.getTime())) {
    return { success: false, error: "The conversion date is invalid." };
  }

  try {
    const Company = (await import("../../models/Company")).default;
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "conversion.date": conv,
        "conversion.setBy": { name: user.name, id: user.id },
        "conversion.setAt": new Date(),
      },
    });

    // Mirrored to Postgres so the company record does not go stale while the
    // opening-balance flow is still Mongo. A missing tenant is not fatal here:
    // the date is only read back from Mongo today.
    try {
      const { setConversionDate: mirror } = await import("@/app/db/platform");
      await mirror(String(companyId), conv, { id: user.id, name: user.name });
    } catch {
      // Nothing reads the Postgres copy yet; a fixture with no tenant is fine.
    }
    revalidatePath("/dashboard/accounts/opening-balances");
    return { success: true };
  } catch (error) {
    console.error("Set conversion date error:", error);
    return { success: false, error: error.message || "Failed to set conversion date." };
  }
}

// Resolve and validate the conversion date + a document date against it.
async function resolveConversionWindow(companyId, docDateStr, label) {
  if (!docDateStr) return { error: `A ${label} date is required.` };
  const docDate = new Date(docDateStr);
  if (Number.isNaN(docDate.getTime())) return { error: `The ${label} date is invalid.` };

  // STILL MONGO, deliberately. The conversion date has a Postgres column
  // (0035) and the backfill fills it, but the documents it governs — opening
  // invoices, bills and their journal entries — are still Mongo. Reading the
  // date from Postgres while the rule is checked against the Mongo ledger puts
  // the rule's data in a different store from the rule's subject, which is the
  // thing 0035 was written to stop. It moves when the opening-balance flow
  // moves; until then app/db/platform.ts keeps the column in step.
  const Company = (await import("../../models/Company")).default;
  const company = await Company.findById(companyId).select("conversion").lean();
  const conversionDate = company?.conversion?.date ? new Date(company.conversion.date) : null;
  if (!conversionDate) {
    return { error: "Set your conversion (cutover) date before entering opening documents." };
  }
  if (docDate > conversionDate) {
    return { error: `The ${label} date must be on or before the conversion date.` };
  }
  return { docDate };
}

const fiscalCode = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const toAmount = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Create + post an opening customer invoice (Dr AR / Cr OBE).
export async function createOpeningInvoice({ customerId, invoiceDate, dueDate, amount } = {}) {
  const guard = await guardOpeningEntry();
  if (!guard.ok) return { success: false, error: guard.error };
  const { user, companyId, isSuperAdmin } = guard;

  try {
    const gross = toAmount(amount);
    if (gross <= 0) return { success: false, error: "Enter an amount greater than zero." };

    const win = await resolveConversionWindow(companyId, invoiceDate, "invoice");
    if (win.error) return { success: false, error: win.error };
    const due = dueDate ? new Date(dueDate) : win.docDate;

    const customer = await Party.findOne({
      _id: customerId,
      ...(isSuperAdmin ? {} : { companyId }),
      type: { $in: ["customer", "both"] },
    }).lean();
    if (!customer) return { success: false, error: "Customer not found." };

    const seq = await ErpCounter.getNextSequence("ob-inv", companyId);
    const invoiceNumber = `OB-INV-${String(seq).padStart(4, "0")}`;

    const invoice = new Invoice({
      companyId,
      invoiceNumber,
      invoiceDate: win.docDate,
      dueDate: due,
      fiscalPeriod: fiscalCode(win.docDate),
      isOpeningBalance: true,
      customer: {
        id: String(customer._id),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      items: [],
      subtotal: gross,
      taxAmount: 0,
      total: gross,
      amountPaid: 0,
      amountDue: gross,
      paymentStatus: "unpaid",
      status: "draft",
      createdBy: { name: user.name, id: user.id },
    });
    await invoice.save();
    await invoice.completeOpening({ name: user.name, id: user.id });

    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true, invoiceNumber };
  } catch (error) {
    console.error("Create opening invoice error:", error);
    return { success: false, error: error.message || "Failed to create opening invoice." };
  }
}

// Create + approve an opening supplier bill (Dr OBE / Cr AP).
export async function createOpeningBill({ supplierId, billDate, dueDate, amount } = {}) {
  const guard = await guardOpeningEntry();
  if (!guard.ok) return { success: false, error: guard.error };
  const { user, companyId, isSuperAdmin } = guard;

  try {
    const gross = toAmount(amount);
    if (gross <= 0) return { success: false, error: "Enter an amount greater than zero." };

    const win = await resolveConversionWindow(companyId, billDate, "bill");
    if (win.error) return { success: false, error: win.error };
    const due = dueDate ? new Date(dueDate) : win.docDate;

    const supplier = await Party.findOne({
      _id: supplierId,
      ...(isSuperAdmin ? {} : { companyId }),
      type: { $in: ["supplier", "both"] },
    }).lean();
    if (!supplier) return { success: false, error: "Supplier not found." };

    const seq = await ErpCounter.getNextSequence("ob-bill", companyId);
    const billNumber = `OB-BILL-${String(seq).padStart(4, "0")}`;

    const bill = new Bill({
      companyId,
      billNumber,
      billDate: win.docDate,
      dueDate: due,
      fiscalPeriod: fiscalCode(win.docDate),
      isOpeningBalance: true,
      supplier: {
        partyId: supplier._id,
        name: supplier.name,
        taxPin: supplier.taxPin,
        email: supplier.email,
        phone: supplier.phone,
      },
      lines: [],
      amounts: {
        subtotal: gross,
        vat: 0,
        total: gross,
        wht: 0,
        netPayable: gross,
        paid: 0,
        balance: gross,
      },
      whtApplicable: false,
      paymentStatus: "unpaid",
      status: "submitted",
      createdBy: { name: user.name, id: user.id },
    });
    await bill.save();
    await bill.approveOpening({ name: user.name, id: user.id });

    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true, billNumber };
  } catch (error) {
    console.error("Create opening bill error:", error);
    return { success: false, error: error.message || "Failed to create opening bill." };
  }
}

// Reverse an opening invoice/bill (pre-go-live correction). Reverses the linked
// opening JE and cancels the document, keeping a full audit trail.
export async function reverseOpeningInvoice(invoiceId) {
  const guard = await guardOpeningEntry();
  if (!guard.ok) return { success: false, error: guard.error };
  const { user, companyId, isSuperAdmin } = guard;

  try {
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      ...(isSuperAdmin ? {} : { companyId }),
      isOpeningBalance: true,
    });
    if (!invoice) return { success: false, error: "Opening invoice not found." };

    const jeId = invoice.accounting?.revenueJournalEntryId;
    if (jeId) {
      const je = await JournalEntry.findById(jeId);
      if (je && je.status === "posted") {
        await je.reverse({ name: user.name, id: user.id }, "Opening invoice reversed during setup");
      }
    }
    invoice.status = "cancelled";
    invoice.lastModifiedBy = { name: user.name, id: user.id };
    await invoice.save();

    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true };
  } catch (error) {
    console.error("Reverse opening invoice error:", error);
    return { success: false, error: error.message || "Failed to reverse opening invoice." };
  }
}

export async function reverseOpeningBill(billId) {
  const guard = await guardOpeningEntry();
  if (!guard.ok) return { success: false, error: guard.error };
  const { user, companyId, isSuperAdmin } = guard;

  try {
    const bill = await Bill.findOne({
      _id: billId,
      ...(isSuperAdmin ? {} : { companyId }),
      isOpeningBalance: true,
    });
    if (!bill) return { success: false, error: "Opening bill not found." };

    const jeId = bill.accounting?.journalEntryId;
    if (jeId) {
      const je = await JournalEntry.findById(jeId);
      if (je && je.status === "posted") {
        await je.reverse({ name: user.name, id: user.id }, "Opening bill reversed during setup");
      }
    }
    bill.status = "cancelled";
    bill.lastModifiedBy = { name: user.name, id: user.id };
    await bill.save();

    revalidatePath("/dashboard/accounts/opening-balances");
    revalidatePath("/dashboard/reports/trial-balance");
    return { success: true };
  } catch (error) {
    console.error("Reverse opening bill error:", error);
    return { success: false, error: error.message || "Failed to reverse opening bill." };
  }
}
