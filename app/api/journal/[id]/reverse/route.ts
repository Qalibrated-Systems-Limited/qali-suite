import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";
import dbConnect from "@/app/config/dbConnect";
import JournalEntry from "@/app/models/JournalEntry";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { checkPlanAccess } from "@/lib/plan-gate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const gate = await checkPlanAccess("finance");
    if (!gate.allowed) {
      return NextResponse.json({ error: "This feature requires a plan upgrade" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { reason } = body;

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        { error: "Reversal reason is required" },
        { status: 400 }
      );
    }

    await dbConnect();

    const { companyId, isSuperAdmin } = await getTenantContext();

    const entry = await JournalEntry.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin)
    );

    if (!entry) {
      return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
    }

    if (entry.status !== "posted") {
      return NextResponse.json(
        { error: "Can only reverse posted entries" },
        { status: 400 }
      );
    }

    if (entry.reversedAt) {
      return NextResponse.json(
        { error: "Entry is already reversed" },
        { status: 400 }
      );
    }

    // Reverse the entry using the model method
    const reversalEntry = await entry.reverse(
      {
        name: session.user.name || "Unknown",
        id: session.user.id || session.user.email,
      },
      reason.trim()
    );

    return NextResponse.json({
      success: true,
      message: "Entry reversed successfully",
      reversalEntryId: reversalEntry._id,
      reversalEntryNumber: reversalEntry.entryNumber,
    });
  } catch (error) {
    console.error("Error reversing journal entry:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Failed to reverse entry") },
      { status: 500 }
    );
  }
}
