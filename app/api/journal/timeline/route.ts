import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJournalEntriesForTimeline } from "@/app/mongodb/queries/journalQueries";
import { serializeBsonType } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;

    const filters = {
      search: searchParams.get("search") || "",
      status: searchParams.get("status") || "all",
      entryType: searchParams.get("entryType") || "all",
      period: searchParams.get("period") || "all",
    };

    const cursor = searchParams.get("cursor") || null;
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const result = await getJournalEntriesForTimeline(filters, limit, cursor);

    return NextResponse.json(serializeBsonType(result));
  } catch (error) {
    console.error("Error fetching journal timeline:", error);
    return NextResponse.json(
      { error: "Failed to fetch journal entries" },
      { status: 500 }
    );
  }
}
