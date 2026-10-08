import { auth } from "@/auth";
import { buildBoqTemplate } from "@/lib/boq/boq-template";

/**
 * Download the standard BOQ Excel template. Any signed-in user may fetch it —
 * it is a blank form, not tenant data.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const buf = await buildBoqTemplate();
  return new Response(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="BOQ-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
