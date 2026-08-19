"use server";

import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

import dbConnect from "../../config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import PettyCashReturn from "../../models/pettyCashReturn";
import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";
import ErpCounter from "../../models/erp-counter";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import { computePettyCashStatement } from "../queries/petty-cash-queries";

// ============================================
// PETTY CASH — custodian records, MD approves
// ============================================
// Custodian builds a draft return for a period (rows derived from the GL),
// submits it to the MD, who reviews how the float was used and approves. On
// approval the spend rows are marked posted and any projects they reference are
// recomputed (project-tagged petty cash becomes project cost).

const CUSTODIAN_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
]);
// The MD signs off. (Managing Director maps to CEO/Admin in the role set.)
// CEO retired (0039). Dropped rather than mapped to Viewer: this is an
// APPROVAL gate, and a read-only role must not inherit an approval right.
const APPROVER_ROLES = new Set(["SuperAdmin", "Admin", "CFO"]);

function isCustodian(user) {
  return CUSTODIAN_ROLES.has(user?.role);
}
function isApprover(user) {
  return APPROVER_ROLES.has(user?.role);
}
function userStamp(user) {
  return { name: user?.name || "Unknown", id: user?.id || "unknown" };
}

async function generateDocNumber(companyId) {
  const seq = await ErpCounter.getNextSequence(`pcrf-${companyId}`, companyId);
  return `PCRF-${String(seq).padStart(4, "0")}`;
}

// ============================================
// GL POSTING — every petty cash movement is double-entry
// ============================================
// Posts a balanced Journal Entry through the same path documents use (full
// account snapshot on each line + JournalEntry.post(), which validates balance,
// accounts and the fiscal period). rawLines: [{ accountId, debit, credit, description }].
async function postPettyCashJE({ companyId, user, entryDate, entryType, description, reference, rawLines }) {
  const ids = rawLines.map((l) => l.accountId);
  const accounts = await Account.find({ _id: { $in: ids }, companyId }).lean();
  const map = new Map(accounts.map((a) => [a._id.toString(), a]));

  const lines = rawLines.map((l) => {
    const a = map.get(l.accountId.toString());
    if (!a) throw new Error(`Account not found: ${l.accountId}`);
    if (!a.canPost) throw new Error(`Account ${a.accountName} cannot post transactions`);
    return {
      accountId: a._id,
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description || "",
    };
  });

  const totalD = lines.reduce((s, l) => s + l.debit, 0);
  const totalC = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalD - totalC) > 0.01) {
    throw new Error(`Petty cash journal is unbalanced: DR ${totalD} vs CR ${totalC}`);
  }

  const entryNumber = await generateUniqueEntryNumber("PC", companyId);
  const date = entryDate ? new Date(entryDate) : new Date();
  const entry = await JournalEntry.create({
    companyId,
    entryNumber,
    entryDate: date,
    entryType,
    description,
    reference: reference || "",
    lines,
    status: "draft",
    createdBy: { name: user?.name || "System", id: user?.id || "system" },
    fiscalYear: date.getFullYear(),
    fiscalMonth: date.getMonth() + 1,
  });
  await entry.post({ name: user?.name || "System", id: user?.id || "system" });
  return entry;
}

// Resolve the COA expense account a spend debits: the row's own account, else a
// Freeze the statement totals onto the return (called at submit/approve) so the
// list and the approved record show a stable figure derived from the GL.
async function snapshotTotals(ret) {
  // Opening is GL-derived inside the statement — don't pass a stored override.
  const { totals, openingBalance } = await computePettyCashStatement(
    { companyId: ret.companyId },
    ret.floatAccountId,
    ret.period?.from,
    ret.period?.to,
  );
  ret.totals = totals;
  ret.openingBalance = openingBalance;
}

// ============================================
// CREATE / OPEN a draft return for a period
// ============================================
export async function createPettyCashReturn({ floatAccountId, from, to } = {}) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!isCustodian(user)) {
      return { success: false, error: "Not authorized to manage petty cash" };
    }
    if (!floatAccountId || !mongoose.Types.ObjectId.isValid(floatAccountId)) {
      return { success: false, error: "Select a petty cash account" };
    }
    if (!from || !to) return { success: false, error: "Period is required" };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // The float must be a real cash/bank account in the tenant.
    const float = await Account.findOne(
      withTenantScope({ _id: floatAccountId }, companyId, isSuperAdmin),
    ).select("_id subType");
    if (!float) return { success: false, error: "Petty cash account not found" };

    // Opening balance is GL-derived from the float as of the period start (set
    // when totals are snapshotted), so there's no return-to-return carry-forward
    // to compute here.
    const documentNumber = await generateDocNumber(tenantCompanyId);
    const ret = await PettyCashReturn.create({
      companyId: tenantCompanyId,
      documentNumber,
      floatAccountId,
      custodian: { userId: user?.id, name: user?.name },
      period: { from: new Date(from), to: new Date(to) },
      status: "draft",
    });

    revalidatePath("/dashboard/petty-cash");
    return { success: true, returnId: ret._id.toString(), documentNumber };
  } catch (error) {
    console.error("createPettyCashReturn error:", error);
    return { success: false, error: error.message || "Failed to create petty cash return" };
  }
}

// ============================================
// FUND petty cash — DR Petty Cash / CR Bank (posts the transfer)
// ============================================
// Moves cash from a bank account into the tin. Posts the balanced transfer to
// the GL; the statement reads it as a float top-up (a DR on the petty cash
// account) — no separate petty-cash row is stored.
export async function fundPettyCash(returnId, input = {}) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!isCustodian(user)) {
      return { success: false, error: "Not authorized to manage petty cash" };
    }

    const ret = await PettyCashReturn.findOne(
      withTenantScope({ _id: returnId }, companyId, isSuperAdmin),
    );
    if (!ret) return { success: false, error: "Return not found" };
    if (ret.status !== "draft") {
      return { success: false, error: "Funds can only be added to a draft return" };
    }

    const { sourceAccountId, amount, date, note } = input;
    const amt = Number(amount);
    if (!sourceAccountId || !mongoose.Types.ObjectId.isValid(sourceAccountId)) {
      return { success: false, error: "Select the bank/source account the float came from" };
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      return { success: false, error: "Enter a valid amount" };
    }
    if (sourceAccountId.toString() === ret.floatAccountId.toString()) {
      return { success: false, error: "Source must differ from the petty cash account" };
    }

    const source = await Account.findOne(
      withTenantScope({ _id: sourceAccountId }, companyId, isSuperAdmin),
    ).select("accountName");
    if (!source) return { success: false, error: "Source account not found" };

    // Post DR Petty Cash / CR Bank.
    let je;
    try {
      je = await postPettyCashJE({
        companyId: ret.companyId,
        user,
        entryDate: date || new Date(),
        entryType: "transfer",
        description: `Petty cash float — ${ret.documentNumber}`,
        reference: ret.documentNumber,
        rawLines: [
          { accountId: ret.floatAccountId, debit: amt, credit: 0, description: note || "Float received" },
          { accountId: sourceAccountId, debit: 0, credit: amt, description: `To petty cash ${ret.documentNumber}` },
        ],
      });
    } catch (err) {
      return { success: false, error: err.message || "Could not post the transfer" };
    }

    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true, entryNumber: je.entryNumber };
  } catch (error) {
    console.error("fundPettyCash error:", error);
    return { success: false, error: error.message || "Failed to fund petty cash" };
  }
}

// ============================================
// SUBMIT — custodian returns the form to the MD
// ============================================
export async function submitPettyCashReturn(returnId) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!isCustodian(user)) {
      return { success: false, error: "Not authorized to manage petty cash" };
    }

    const ret = await PettyCashReturn.findOne(
      withTenantScope({ _id: returnId }, companyId, isSuperAdmin),
    );
    if (!ret) return { success: false, error: "Return not found" };
    if (ret.status !== "draft") {
      return { success: false, error: `Return is already ${ret.status}` };
    }

    ret.status = "submitted";
    ret.preparedBy = { ...userStamp(user), at: new Date() };
    await snapshotTotals(ret); // freeze the statement totals at submission
    await ret.save();

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true };
  } catch (error) {
    console.error("submitPettyCashReturn error:", error);
    return { success: false, error: error.message || "Failed to submit return" };
  }
}

// ============================================
// APPROVE — MD signs off; post spends + recompute projects
// ============================================
export async function approvePettyCashReturn(returnId) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!isApprover(user)) {
      return { success: false, error: "Only the MD / finance leadership can approve petty cash" };
    }

    const ret = await PettyCashReturn.findOne(
      withTenantScope({ _id: returnId }, companyId, isSuperAdmin),
    );
    if (!ret) return { success: false, error: "Return not found" };
    if (ret.status !== "submitted") {
      return { success: false, error: "Only submitted returns can be approved" };
    }

    // No GL posting here: the spends are real Expenses (already posted DR
    // Expense / CR Petty Cash) and the float top-ups already posted at fund
    // time. Approval is a SIGN-OFF on the statement — we just freeze the totals.
    ret.status = "approved";
    ret.approvedBy = { ...userStamp(user), at: new Date() };
    await snapshotTotals(ret);
    await ret.save();

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true };
  } catch (error) {
    console.error("approvePettyCashReturn error:", error);
    return { success: false, error: error.message || "Failed to approve return" };
  }
}

// ============================================
// REJECT — MD sends it back to the custodian
// ============================================
export async function rejectPettyCashReturn(returnId, reason = "") {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!isApprover(user)) {
      return { success: false, error: "Only the MD / finance leadership can reject petty cash" };
    }

    const ret = await PettyCashReturn.findOne(
      withTenantScope({ _id: returnId }, companyId, isSuperAdmin),
    );
    if (!ret) return { success: false, error: "Return not found" };
    if (ret.status !== "submitted") {
      return { success: false, error: "Only submitted returns can be rejected" };
    }

    ret.status = "draft"; // back to the custodian to fix
    ret.rejectionReason = reason || "Returned for correction";
    ret.reviewedBy = { ...userStamp(user), at: new Date() };
    await ret.save();

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true };
  } catch (error) {
    console.error("rejectPettyCashReturn error:", error);
    return { success: false, error: error.message || "Failed to reject return" };
  }
}
