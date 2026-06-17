"use server";

import { revalidatePath } from "next/cache";

import JournalEntry from "@/app/models/JournalEntry";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

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
    // non-reversed opening entry already exists; the user must reverse it first.
    const existing = await JournalEntry.findOne({
      companyId,
      entryType: "opening_balance",
      status: { $ne: "reversed" },
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
