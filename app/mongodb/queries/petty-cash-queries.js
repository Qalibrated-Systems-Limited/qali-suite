import mongoose from "mongoose";
import PettyCashReturn from "../../models/pettyCashReturn";
import Account from "../../models/account";
import Project from "../../models/project";
import Expense from "../../models/expenses";
import JournalEntry from "../../models/JournalEntry";
import dbConnect from "../../config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

const { ObjectId } = mongoose.Types;

function tenantMatch(companyId, isSuperAdmin) {
  return isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
}

// ============================================
// PETTY CASH STATEMENT — derived from the GL, not typed
// ============================================
// The petty cash account's activity over a date range, like a bank statement:
// CR = money out (every Expense paid FROM the float), DR = money in (float
// top-ups / transfers that debit the float in the GL). Because spends are real
// Expenses, they already post to the GL and feed project cost — the statement
// only DISPLAYS them, so nothing is double-counted or re-typed.
//
// `tm` is the resolved tenant match; `floatId`/`from`/`to` are normalised.
export async function computePettyCashStatement(tm, floatId, from, to, opening = null) {
  const fromD = new Date(from);
  const toD = new Date(to);
  const r2 = (n) => Math.round((n || 0) * 100) / 100;

  const [expenses, topupAgg, projects, glAgg] = await Promise.all([
    // Spends OUT of the tin — expenses actually PAID from this account.
    // Only "paid" is real cash disbursed: a "posted" expense is an unpaid
    // accrual (the model sets status="posted"/paymentStatus="unpaid" together),
    // so counting it as money out would understate the float balance.
    Expense.find({
      ...tm,
      paidFrom: floatId,
      status: "paid",
      expenseDate: { $gte: fromD, $lte: toD },
    })
      .select("expenseDate description category projectId accountName vendor total expenseNumber")
      .lean(),
    // Money IN — any posted JE that debits the float (float receipts/top-ups).
    JournalEntry.aggregate([
      { $match: { ...tm, status: "posted", entryDate: { $gte: fromD, $lte: toD } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": floatId, "lines.debit": { $gt: 0 } } },
      { $project: { date: "$entryDate", description: 1, amount: "$lines.debit", entryNumber: 1 } },
    ]),
    Project.find({ ...tm }).select("name projectNumber").lean(),
    // GL position of the float — the single source of truth for the balances.
    // Opening = net of every posted line dated BEFORE `from` (so opening
    // balances and prior periods are reflected automatically); closing = net
    // through `to`. One pass, split by date with $cond.
    JournalEntry.aggregate([
      { $match: { ...tm, status: "posted", "lines.accountId": floatId, entryDate: { $lte: toD } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": floatId } },
      {
        $group: {
          _id: null,
          openDebit: { $sum: { $cond: [{ $lt: ["$entryDate", fromD] }, "$lines.debit", 0] } },
          openCredit: { $sum: { $cond: [{ $lt: ["$entryDate", fromD] }, "$lines.credit", 0] } },
          totDebit: { $sum: "$lines.debit" },
          totCredit: { $sum: "$lines.credit" },
        },
      },
    ]),
  ]);

  const gl = glAgg[0] || { openDebit: 0, openCredit: 0, totDebit: 0, totCredit: 0 };
  const glOpening = r2(gl.openDebit - gl.openCredit); // float is debit-normal
  const glClosing = r2(gl.totDebit - gl.totCredit);

  // Opening is GL-derived by default; an explicit value overrides it (kept for
  // back-compat and inception seeding).
  const openingBalance = opening != null ? opening : glOpening;

  const projName = new Map(projects.map((p) => [p._id.toString(), p.name]));

  const rows = [
    ...topupAgg.map((t) => ({
      kind: "topup",
      date: t.date,
      name: "Float received",
      description: t.description || "Float top-up",
      projectLabel: "",
      direction: "debit",
      amount: t.amount,
      ref: t.entryNumber,
    })),
    ...expenses.map((e) => ({
      kind: "expense",
      date: e.expenseDate,
      name: e.vendor?.name || "",
      description: e.description || e.accountName || "",
      projectLabel: e.projectId
        ? projName.get(e.projectId.toString()) || ""
        : e.category || "",
      direction: "credit",
      amount: e.total,
      ref: e.expenseNumber,
      expenseId: e._id,
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = openingBalance;
  let debits = 0;
  let credits = 0;
  for (const r of rows) {
    if (r.direction === "debit") {
      balance += r.amount;
      debits += r.amount;
    } else {
      balance -= r.amount;
      credits += r.amount;
    }
    r.balance = r2(balance);
  }

  // What the custodian's top-ups/expenses account for vs. what the GL says is
  // actually in the float. A non-zero variance flags cash movements the expense
  // list doesn't capture (transfers, refunds, manual corrections) — i.e. over/short.
  const accountedClosing = r2(openingBalance + debits - credits);
  const variance = r2(glClosing - accountedClosing);

  return {
    rows,
    openingBalance,
    totals: {
      debits: r2(debits),
      credits: r2(credits),
      closing: accountedClosing,
      glClosing,
      variance,
    },
  };
}

// ============================================
// FLOAT ACCOUNTS — cash accounts that can hold a petty cash float
// ============================================
export async function getPettyCashFloatAccounts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find({
    ...tenantMatch(companyId, isSuperAdmin),
    subType: { $in: ["cash", "mpesa", "bank"] },
    isActive: true,
    canPost: true,
  })
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType systemAccount")
    .lean();

  return serializeBsonType(accounts);
}

// ============================================
// EXPENSE ACCOUNTS — the category a spend posts to (DR side)
// ============================================
export async function getPettyCashExpenseAccounts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find({
    ...tenantMatch(companyId, isSuperAdmin),
    accountType: "expense",
    isActive: true,
    canPost: true,
  })
    .sort({ accountCode: 1 })
    .select("accountCode accountName")
    .lean();

  return serializeBsonType(accounts);
}

// ============================================
// LIST RETURNS
// ============================================
export async function getPettyCashReturns({ status } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const match = { ...tenantMatch(companyId, isSuperAdmin) };
  if (status) match.status = status;

  const returns = await PettyCashReturn.find(match)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  // Attach float account names in one query.
  const accIds = [...new Set(returns.map((r) => r.floatAccountId?.toString()))];
  const accounts = await Account.find({ _id: { $in: accIds } })
    .select("accountName")
    .lean();
  const accName = new Map(accounts.map((a) => [a._id.toString(), a.accountName]));

  return serializeBsonType(
    returns.map((r) => ({
      ...r,
      floatAccountName: accName.get(r.floatAccountId?.toString()) || "Petty Cash",
    })),
  );
}

// ============================================
// RETURN DETAIL — header + ledger rows (DR/CR/Project-or-Purpose)
// ============================================
export async function getPettyCashReturnById(returnId) {
  if (!returnId || !mongoose.Types.ObjectId.isValid(returnId)) return null;
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const tm = tenantMatch(companyId, isSuperAdmin);
  const ret = await PettyCashReturn.findOne({
    ...tm,
    _id: new ObjectId(returnId),
  }).lean();
  if (!ret) return null;

  // The lines are DERIVED from the GL for the float over the return's period —
  // every expense paid from the tin + any float top-ups. Nothing is typed, so
  // the statement always reflects the real spend.
  const [statement, float] = await Promise.all([
    // Opening is GL-derived inside the statement (reflects opening balances and
    // prior periods) — no stored override.
    computePettyCashStatement(
      tm,
      ret.floatAccountId,
      ret.period?.from,
      ret.period?.to,
    ),
    Account.findById(ret.floatAccountId).select("accountName accountCode").lean(),
  ]);

  return serializeBsonType({
    ...ret,
    float: float || null,
    openingBalance: statement.openingBalance,
    rows: statement.rows,
    totals: statement.totals,
  });
}
