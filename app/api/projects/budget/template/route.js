import { auth } from "@/auth";
import { buildBudgetTemplate } from "@/lib/budget/budget-template";

/**
 * Download the standard budget-upload Excel template. Any signed-in user may
 * fetch it — it is a blank form, not tenant data.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const buf = await buildBudgetTemplate();
  return new Response(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="budget-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
