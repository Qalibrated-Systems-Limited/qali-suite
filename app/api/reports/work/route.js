import { NextResponse } from "next/server";
import { getWorkReportFor } from "@/app/db/actions/tasks-actions";

/** The work report as CSV, for a spreadsheet. Same access as the screen. */
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  try {
    const r = await getWorkReportFor(p.get("period") || "week", p.get("from") || undefined, p.get("to") || undefined);
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      [`Work report`, r.label, `${r.from} to ${r.to} (end exclusive)`].map(q).join(","),
      "",
      ["Source", "Assigned", "Completed", "Open now", "Overdue now"].map(q).join(","),
      ...r.bySource.map((s) => [s.source, s.assigned, s.completed, s.open, s.overdue].map(q).join(",")),
      "",
      ["Person", "Completed in period", "Open now", "Overdue now"].map(q).join(","),
      ...r.byPerson.map((x) => [x.name, x.completed, x.open, x.overdue].map(q).join(",")),
      "",
      ["Help desk", "Value"].map(q).join(","),
      ...[
        ["Opened in period", r.tickets.opened],
        ["Resolved in period", r.tickets.resolved],
        ["Resolved within SLA", r.tickets.slaMet],
        ["Resolved with an SLA", r.tickets.slaMeasured],
        ["Average hours to resolve", r.tickets.avgResolutionHours ?? ""],
        ["Average hours to first response", r.tickets.avgFirstResponseHours ?? ""],
        ["Open now", r.tickets.open],
        ["Open past SLA", r.tickets.breachedOpen],
      ].map((row) => row.map(q).join(",")),
      "",
      ["Ticket category", "Opened", "Resolved", "Open now"].map(q).join(","),
      ...r.ticketsByCategory.map((c) => [c.category, c.opened, c.resolved, c.open].map(q).join(",")),
    ];
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="work-report-${r.from}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "The report could not be produced" }, { status: 403 });
  }
}
