import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountsByTypePg } from "@/app/db/actions/account-actions";

/**
 * Accounts grouped by type, for the account pickers.
 *
 * POSTGRES since 0102. This read the MONGO `Account` collection, which nothing
 * has written to since the chart of accounts moved — so the pickers built from
 * it listed accounts that no longer exist and omitted every account created
 * since. The response shape is byte-for-byte what it was, `_id` included,
 * because the components consuming it were written against the Mongo shape.
 *
 * The action does the authorisation and the tenant scope; this route is the
 * transport, which is the same split as /api/journal/[id]/post.
 */
export async function GET(request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const types = (searchParams.get("types") || "asset")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    return NextResponse.json(await getAccountsByTypePg(types));
  } catch (error) {
    console.error("GET /api/accounts/by-type error:", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 },
    );
  }
}
