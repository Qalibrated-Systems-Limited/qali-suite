import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { postJournalEntry } from "@/app/db/actions/journal-actions";
import { checkPlanAccess } from "@/lib/plan-gate";

/**
 * Post a draft journal entry.
 *
 * POSTGRES. This route loaded the entry from the MONGO `JournalEntry`
 * collection and called its model's `post()`, while `/dashboard/journal/create`
 * had been writing to Postgres since the ledger moved. Once the browser was
 * repointed the ids stopped matching entirely — a Postgres uuid handed to a
 * Mongo `findOne({ _id })` — so this button could only ever have failed.
 *
 * The action does the authorisation and the tenant scope; this route is the
 * transport, because `JournalPageClient` calls it with `fetch`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gate = await checkPlanAccess("finance");
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "This feature requires a plan upgrade" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const result = await postJournalEntry(id);

  // The action already turns a driver failure into a sentence; a 400 is right
  // for "already posted" and for every other refusal the ledger makes.
  if (result.success === false) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: result.message });
}
