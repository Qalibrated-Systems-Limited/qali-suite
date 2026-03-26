import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Account from "@/app/models/account";

export async function GET(request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const { searchParams } = new URL(request.url);
    const types = (searchParams.get("types") || "asset").split(",").map((t) => t.trim());

    const result = {};

    for (const accountType of types) {
      const query = withTenantScope(
        { accountType, isActive: true },
        companyId,
        isSuperAdmin,
      );

      const accounts = await Account.find(query)
        .select("accountCode accountName accountType")
        .sort({ accountCode: 1 })
        .lean();

      result[accountType] = accounts.map((a) => ({
        _id: a._id.toString(),
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
      }));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/accounts/by-type error:", error);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}
