import mongoose from "mongoose";
import PettyCashReturn from "../../models/pettyCashReturn";
import PettyCashEntry from "../../models/pettyCashEntry";
import Account from "../../models/account";
import Project from "../../models/project";
import dbConnect from "../../config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

const { ObjectId } = mongoose.Types;

function tenantMatch(companyId, isSuperAdmin) {
  return isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
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

  const ret = await PettyCashReturn.findOne({
    ...tenantMatch(companyId, isSuperAdmin),
    _id: new ObjectId(returnId),
  }).lean();
  if (!ret) return null;

  const entries = await PettyCashEntry.find({ returnId: ret._id })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  // Resolve project + float names for display.
  const projectIds = [
    ...new Set(
      entries
        .map((e) => e.allocation?.projectId?.toString())
        .filter(Boolean),
    ),
  ];
  const [projects, float] = await Promise.all([
    projectIds.length
      ? Project.find({ _id: { $in: projectIds } }).select("name projectNumber").lean()
      : [],
    Account.findById(ret.floatAccountId).select("accountName accountCode").lean(),
  ]);
  const projName = new Map(projects.map((p) => [p._id.toString(), p]));

  // Compute a running balance for the ledger view (opening + DR − CR).
  let balance = ret.openingBalance || 0;
  const rows = entries.map((e) => {
    if (e.direction === "debit") balance += e.amount;
    else balance -= e.amount;
    const proj = projName.get(e.allocation?.projectId?.toString());
    return {
      ...e,
      projectLabel: proj ? proj.name : e.allocation?.purpose || "",
      balance,
    };
  });

  return serializeBsonType({
    ...ret,
    float: float || null,
    rows,
  });
}
