import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
import JournalEntry from "@/app/models/JournalEntry";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await dbConnect();

    const { companyId, isSuperAdmin } = await getTenantContext();

    const entry = await JournalEntry.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin)
    );

    if (!entry) {
      return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
    }

    if (entry.status === "posted") {
      return NextResponse.json(
        { error: "Entry is already posted" },
        { status: 400 }
      );
    }

    if (entry.status === "reversed") {
      return NextResponse.json(
        { error: "Cannot post a reversed entry" },
        { status: 400 }
      );
    }

    // Post the entry using the model method
    await entry.post({
      name: session.user.name || "Unknown",
      id: session.user.id || session.user.email,
    });

    return NextResponse.json({
      success: true,
      message: "Entry posted successfully",
    });
  } catch (error) {
    console.error("Error posting journal entry:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to post entry" },
      { status: 500 }
    );
  }
}
