import mongoose from "mongoose";
import PettyCashReturn from "../../models/pettyCashReturn";
import Account from "../../models/account";
import {
  listExpensesPaidFromPg,
  getAccountPositionPg,
  listAccountDebitsPg,
} from "@/app/db/actions/petty-cash-reads";
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
// BOTH HALVES ARE POSTGRES NOW (0059/0060).
//
// This function is why the plan said expenses had to move first. It reads the
// GL for the float's opening and closing position AND the expense rows for the
// spend, and until 0059 both were Mongo — so it was self-consistent inside one
// store even while the ledger screens read another. Porting petty cash's
// postings without porting expenses would have split it across two stores:
// balances from one, spend rows from the other, disagreeing on the same float.
//
// `tm` is kept in the signature and ignored: tenant scope is RLS now, not a
// match object the caller assembles and every query has to remember to spread.
// The parameter stays so petty-cash-actions.js does not have to change in the
// same commit as the store.
export async function computePettyCashStatement(tm, floatId, from, to, opening = null) {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const day = (d) =>
    d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const fromD = day(from);
  const toD = day(to);

  const [spend, topups, position] = await Promise.all([
    listExpensesPaidFromPg(floatId, { from: fromD, to: toD }),
    listAccountDebitsPg(floatId, { from: fromD, to: toD }),
    getAccountPositionPg(floatId, { from: fromD, to: toD }),
  ]);

  // The float is debit-normal.
  const glOpening = r2(position.opening);
  const glClosing = r2(position.closing);

  // Opening is GL-derived by default; an explicit value overrides it (kept for
  // back-compat and inception seeding).
  const openingBalance = opening != null ? opening : glOpening;

  const rows = [
    ...topups.map((t) => ({
      kind: "topup",
      date: t.entryDate,
      name: "Float received",
      description: t.description || "Float top-up",
      projectLabel: "",
      direction: "debit",
      amount: r2(t.amount),
      ref: t.entryNumber,
    })),
    ...spend.map((e) => ({
      kind: "expense",
      date: e.expenseDate,
      name: e.payeeName || "",
      description: e.description || e.accountName || "",
      // The project NAME is snapshotted on the expense now, so the statement
      // no longer has to load every project in the company to label a handful
      // of rows — and a project since renamed still reads as it did.
      projectLabel: e.projectName || e.category || "",
      direction: "credit",
      amount: r2(e.total),
      ref: e.expenseNumber,
      expenseId: e.id,
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
