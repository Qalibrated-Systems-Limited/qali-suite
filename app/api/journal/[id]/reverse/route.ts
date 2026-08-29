import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { reverseJournalEntry } from "@/app/db/actions/journal-actions";
import { checkPlanAccess } from "@/lib/plan-gate";

/**
 * Reverse a posted journal entry.
 *
 * POSTGRES, for the same reason as the post route beside it: this reversed an
 * entry in the Mongo ledger, and the ids it is now handed are Postgres uuids.
 *
 * A reversal needs a reason. The Mongo route accepted the body's `reason` and
 * the repository requires one, so an empty body is refused here rather than
 * failing further down with a constraint message.
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

  let reason = "";
  try {
    const body = await request.json();
    reason = String(body?.reason ?? "").trim();
  } catch {
    reason = "";
  }

  if (!reason) {
    return NextResponse.json(
      { error: "Say why the entry is being reversed." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await reverseJournalEntry(id, reason);

  if (result.success === false) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: result.message });
}
