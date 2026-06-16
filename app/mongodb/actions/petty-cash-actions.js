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
import PettyCashEntry from "../../models/pettyCashEntry";
import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";
import ErpCounter from "../../models/erp-counter";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import { recomputeProjectFinancials } from "./project-actions";

// ============================================
// PETTY CASH — custodian records, MD approves
// ============================================
// Custodian builds a draft return for a period (rows = PettyCashEntry), submits
// it to the MD, who reviews how the float was used and approves. On approval
// the spend rows are marked posted and any projects they reference are
// recomputed (project-tagged petty cash becomes project cost).

const CUSTODIAN_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
]);
// The MD signs off. (Managing Director maps to CEO/Admin in the role set.)
const APPROVER_ROLES = new Set(["SuperAdmin", "Admin", "CEO", "CFO"]);

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
// sensible company default (Petty Cash / Sundry, else any postable expense).
async function resolveExpenseAccount(companyId, preferredId) {
  if (preferredId) return preferredId;
  const candidates = await Account.find({
    companyId,
    accountType: "expense",
    canPost: true,
    isActive: true,
  })
    .select("accountName subType")
    .lean();
  if (candidates.length === 0) return null;
  const pick =
    candidates.find((a) => /petty|sundry|misc/i.test(a.accountName)) ||
    candidates.find((a) => a.subType === "operating_expense") ||
    candidates[0];
  return pick._id;
}

// Recompute a return's totals from its entries. Sessionless, post-write —
// debits are float top-ups, credits are spend.
async function recomputeReturnTotals(returnId) {
  const rows = await PettyCashEntry.find({ returnId }).select("direction amount").lean();
  const debits = rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);
  const credits = rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
  const ret = await PettyCashReturn.findById(returnId).select("openingBalance");
  if (!ret) return;
  await PettyCashReturn.findByIdAndUpdate(returnId, {
    $set: {
      "totals.debits": debits,
      "totals.credits": credits,
      "totals.closing": (ret.openingBalance || 0) + debits - credits,
    },
  });
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

    // Opening balance carries forward from the last approved return on this float.
    const last = await PettyCashReturn.findOne({
      companyId: tenantCompanyId,
      floatAccountId,
      status: "approved",
    })
      .sort({ "period.to": -1 })
      .select("totals.closing")
      .lean();
    const openingBalance = last?.totals?.closing || 0;

    const documentNumber = await generateDocNumber(tenantCompanyId);
    const ret = await PettyCashReturn.create({
      companyId: tenantCompanyId,
      documentNumber,
      floatAccountId,
      custodian: { userId: user?.id, name: user?.name },
      period: { from: new Date(from), to: new Date(to) },
      openingBalance,
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
// ADD an entry (row) to a draft return
// ============================================
export async function addPettyCashEntry(returnId, input = {}) {
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
      return { success: false, error: "Entries can only be added to a draft return" };
    }

    const {
      date,
      payeeName,
      partyId,
      description,
      projectId,
      costCodeId,
      purpose,
      expenseAccountId,
      direction = "credit",
      amount,
    } = input;

    // A float top-up moves cash from the bank into the tin (DR Petty Cash /
    // CR Bank) and must post that transfer — so it goes through fundPettyCash,
    // not here. This action records spends only.
    if (direction !== "credit") {
      return {
        success: false,
        error: 'Use "Fund petty cash" to record a float top-up — it posts the bank transfer.',
      };
    }

    // Float guardrail: petty cash is small cash from a LIMITED tin. A spend
    // can't exceed the available balance — purchases beyond the float (e.g.
    // construction materials) belong in a Bill/Expense paid from the bank,
    // project-tagged, not in petty cash.
    const amt = Number(amount);
    if (direction === "credit") {
      const available = ret.totals?.closing ?? ret.openingBalance ?? 0;
      if (amt > available) {
        return {
          success: false,
          error: `This exceeds the petty cash balance (${available.toLocaleString()}). Record purchases beyond the float as a Bill or Expense paid from the bank.`,
        };
      }
    }

    try {
      await PettyCashEntry.create({
        companyId: ret.companyId,
        floatAccountId: ret.floatAccountId,
        returnId: ret._id,
        date: date ? new Date(date) : new Date(),
        payee: { partyId: partyId || undefined, name: payeeName },
        description,
        allocation: {
          projectId: projectId || null,
          costCodeId: costCodeId || null,
          purpose: purpose || "",
        },
        expenseAccountId: expenseAccountId || null,
        direction,
        amount: Number(amount),
        createdBy: userStamp(user),
      });
    } catch (err) {
      // Surface the project-or-purpose rule and amount validation cleanly.
      return { success: false, error: err.message || "Invalid entry" };
    }

    await recomputeReturnTotals(ret._id);
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true };
  } catch (error) {
    console.error("addPettyCashEntry error:", error);
    return { success: false, error: error.message || "Failed to add entry" };
  }
}

// ============================================
// FUND petty cash — DR Petty Cash / CR Bank (posts the transfer)
// ============================================
// Moves cash from a bank account into the tin. Posts the balanced transfer to
// the GL and records it as a debit row on the draft return so it shows on the
// form and raises the float balance.
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

    // Record the matching debit row (already real cash, so posted).
    await PettyCashEntry.create({
      companyId: ret.companyId,
      floatAccountId: ret.floatAccountId,
      returnId: ret._id,
      date: date ? new Date(date) : new Date(),
      payee: { name: source.accountName },
      description: note || "Float received",
      allocation: { purpose: "Float top-up" },
      sourceAccountId,
      journalEntryId: je._id,
      direction: "debit",
      amount: amt,
      posted: true,
      createdBy: userStamp(user),
    });

    await recomputeReturnTotals(ret._id);
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true, entryNumber: je.entryNumber };
  } catch (error) {
    console.error("fundPettyCash error:", error);
    return { success: false, error: error.message || "Failed to fund petty cash" };
  }
}

// ============================================
// REMOVE an entry from a draft return
// ============================================
export async function removePettyCashEntry(entryId) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!isCustodian(user)) {
      return { success: false, error: "Not authorized to manage petty cash" };
    }

    const entry = await PettyCashEntry.findOne(
      withTenantScope({ _id: entryId }, companyId, isSuperAdmin),
    );
    if (!entry) return { success: false, error: "Entry not found" };

    const ret = await PettyCashReturn.findById(entry.returnId).select("status");
    if (ret?.status !== "draft") {
      return { success: false, error: "Only entries on a draft return can be removed" };
    }

    const returnId = entry.returnId;
    await entry.deleteOne();
    await recomputeReturnTotals(returnId);
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return { success: true };
  } catch (error) {
    console.error("removePettyCashEntry error:", error);
    return { success: false, error: error.message || "Failed to remove entry" };
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

    const count = await PettyCashEntry.countDocuments({ returnId: ret._id });
    if (count === 0) {
      return { success: false, error: "Add at least one entry before submitting" };
    }

    ret.status = "submitted";
    ret.preparedBy = { ...userStamp(user), at: new Date() };
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

    // Post the spends: DR each expense account / CR Petty Cash (one balanced JE
    // for the whole return). Funding transfers already posted at fund time.
    const spends = await PettyCashEntry.find({
      returnId: ret._id,
      direction: "credit",
    }).lean();

    let spendJE = null;
    if (spends.length > 0) {
      // Group debits by the resolved expense account.
      const byAccount = new Map();
      for (const s of spends) {
        const acc = await resolveExpenseAccount(ret.companyId, s.expenseAccountId);
        if (!acc) {
          return {
            success: false,
            error: "No expense account configured. Create an expense account (e.g. Petty Cash Expenses) before approving.",
          };
        }
        const key = acc.toString();
        byAccount.set(key, (byAccount.get(key) || 0) + s.amount);
      }
      const totalSpend = spends.reduce((sum, s) => sum + s.amount, 0);
      const rawLines = [
        ...[...byAccount.entries()].map(([accountId, amt]) => ({
          accountId,
          debit: amt,
          credit: 0,
          description: `Petty cash spend — ${ret.documentNumber}`,
        })),
        { accountId: ret.floatAccountId, debit: 0, credit: totalSpend, description: `Petty cash ${ret.documentNumber}` },
      ];
      try {
        spendJE = await postPettyCashJE({
          companyId: ret.companyId,
          user,
          entryDate: ret.period?.to || new Date(),
          entryType: "expense",
          description: `Petty cash expenses — ${ret.documentNumber}`,
          reference: ret.documentNumber,
          rawLines,
        });
      } catch (err) {
        return { success: false, error: err.message || "Could not post petty cash expenses" };
      }
    }

    ret.status = "approved";
    ret.approvedBy = { ...userStamp(user), at: new Date() };
    await ret.save();

    // Mark spend rows posted + link the JE — only now are they real cost.
    await PettyCashEntry.updateMany(
      { returnId: ret._id, direction: "credit" },
      { $set: { posted: true, ...(spendJE ? { journalEntryId: spendJE._id } : {}) } },
    );

    // Project-tagged spends now feed project cost — recompute each project.
    const projectIds = await PettyCashEntry.distinct("allocation.projectId", {
      returnId: ret._id,
      direction: "credit",
      "allocation.projectId": { $ne: null },
    });
    for (const pid of projectIds) {
      try {
        await recomputeProjectFinancials(pid.toString());
      } catch (err) {
        console.error("project recompute after petty cash approval failed:", err.message);
      }
    }

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
