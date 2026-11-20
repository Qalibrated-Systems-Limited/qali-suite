import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getWorkReportFor } from "@/app/db/actions/tasks-actions";
import PrintButton from "./PrintButton";

export const metadata = {
  title: "Work report | Tasks",
  description: "Tasks and tickets for a period — assigned, completed, open and late, by source and by person",
};
export const dynamic = "force-dynamic";

const PERIODS = [
  ["week", "Last 7 days"],
  ["month", "Last 30 days"],
  ["quarter", "Last 3 months"],
];

const cell = { padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 13, textAlign: "left" };
const head = { ...cell, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" };
const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };

export default async function WorkReportPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = (await searchParams) || {};
  const period = ["week", "month", "quarter", "custom"].includes(sp.period) ? sp.period : "week";

  let r;
  try {
    r = await getWorkReportFor(period, sp.from, sp.to);
  } catch (e) {
    return (
      <div style={{ padding: 26 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Work report</h1>
        <p style={{ color: "var(--muted-foreground)" }}>{e?.message || "You don't have access to this report."}</p>
        <Link href="/dashboard/tasks">← Back to Tasks</Link>
      </div>
    );
  }

  const qs = new URLSearchParams({ period, ...(period === "custom" ? { from: sp.from, to: sp.to } : {}) });
  const t = r.tickets;
  const slaPct = t.slaMeasured ? Math.round((t.slaMet / t.slaMeasured) * 100) : null;
  const totals = r.bySource.reduce(
    (a, s) => ({ assigned: a.assigned + s.assigned, completed: a.completed + s.completed, open: a.open + s.open, overdue: a.overdue + s.overdue }),
    { assigned: 0, completed: 0, open: 0, overdue: 0 },
  );
  const toInclusive = new Date(new Date(`${r.to}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)", maxWidth: 1100 }}>
      <div className="no-print" style={{ marginBottom: 8 }}>
        <Link href="/dashboard/tasks" style={{ fontSize: 13 }}>← Tasks</Link>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Work report — tasks &amp; tickets</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted-foreground)", fontSize: 13 }}>
            {r.label} · {r.from} to {toInclusive}. Open and overdue are as of today.
          </p>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {PERIODS.map(([v, l]) => (
            <Link
              key={v}
              href={`/dashboard/tasks/report?period=${v}`}
              style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "1.5px solid var(--border)", background: period === v ? "var(--foreground)" : "transparent", color: period === v ? "var(--background)" : "var(--foreground)", textDecoration: "none" }}
            >
              {l}
            </Link>
          ))}
          <form action="/dashboard/tasks/report" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="hidden" name="period" value="custom" />
            <input type="date" name="from" defaultValue={period === "custom" ? sp.from : r.from} required style={{ fontSize: 12, padding: 4 }} />
            <input type="date" name="to" defaultValue={period === "custom" ? sp.to : toInclusive} required style={{ fontSize: 12, padding: 4 }} />
            <button type="submit" style={{ fontSize: 12, padding: "5px 10px", fontWeight: 700 }}>Apply</button>
          </form>
          <a href={`/api/reports/work?${qs}`} style={{ fontSize: 12, fontWeight: 700 }}>Download CSV</a>
          <PrintButton />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "18px 0" }}>
        {[
          ["Assigned in period", totals.assigned],
          ["Completed in period", totals.completed],
          ["Open now", totals.open],
          ["Overdue now", totals.overdue, totals.overdue ? "#b91c1c" : null],
          ["Tickets resolved within SLA", slaPct == null ? "—" : `${slaPct}%`],
        ].map(([l, v, c]) => (
          <div key={l} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted-foreground)" }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c || "var(--foreground)" }}>{v}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "18px 0 6px" }}>By source</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={head}>Source</th><th style={{ ...head, textAlign: "right" }}>Assigned</th><th style={{ ...head, textAlign: "right" }}>Completed</th><th style={{ ...head, textAlign: "right" }}>Open</th><th style={{ ...head, textAlign: "right" }}>Overdue</th></tr></thead>
        <tbody>
          {r.bySource.map((s) => (
            <tr key={s.source}>
              <td style={cell}>{s.source}</td><td style={num}>{s.assigned}</td><td style={num}>{s.completed}</td><td style={num}>{s.open}</td>
              <td style={{ ...num, color: s.overdue ? "#b91c1c" : undefined, fontWeight: s.overdue ? 700 : 400 }}>{s.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "22px 0 6px" }}>By person</h2>
      {r.byPerson.length === 0 ? (
        <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Nobody had assigned work open or completed in this period.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={head}>Person</th><th style={{ ...head, textAlign: "right" }}>Completed in period</th><th style={{ ...head, textAlign: "right" }}>Open now</th><th style={{ ...head, textAlign: "right" }}>Overdue now</th></tr></thead>
          <tbody>
            {r.byPerson.map((p) => (
              <tr key={p.userId}>
                <td style={cell}>{p.name}</td><td style={num}>{p.completed}</td><td style={num}>{p.open}</td>
                <td style={{ ...num, color: p.overdue ? "#b91c1c" : undefined, fontWeight: p.overdue ? 700 : 400 }}>{p.overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "22px 0 6px" }}>Help desk service level</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", maxWidth: 640 }}>
        <tbody>
          {[
            ["Tickets opened in period", t.opened],
            ["Tickets resolved in period", t.resolved],
            ["Resolved within SLA", t.slaMeasured ? `${t.slaMet} of ${t.slaMeasured} (${slaPct}%)` : "—"],
            ["Average time to resolve", t.avgResolutionHours == null ? "—" : `${t.avgResolutionHours} h`],
            ["Average first response", t.avgFirstResponseHours == null ? "—" : `${t.avgFirstResponseHours} h`],
            ["Open now", t.open],
            ["Open and past their SLA", t.breachedOpen],
          ].map(([l, v]) => (
            <tr key={l}><td style={cell}>{l}</td><td style={num}>{v}</td></tr>
          ))}
        </tbody>
      </table>

      {r.ticketsByCategory.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 800, margin: "16px 0 6px" }}>Tickets by category</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", maxWidth: 640 }}>
            <thead><tr><th style={head}>Category</th><th style={{ ...head, textAlign: "right" }}>Opened</th><th style={{ ...head, textAlign: "right" }}>Resolved</th><th style={{ ...head, textAlign: "right" }}>Open now</th></tr></thead>
            <tbody>
              {r.ticketsByCategory.map((c) => (
                <tr key={c.category}><td style={cell}>{c.category}</td><td style={num}>{c.opened}</td><td style={num}>{c.resolved}</td><td style={num}>{c.open}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <style>{`@media print { .no-print { display: none !important; } nav, aside, header { display: none !important; } }`}</style>
    </div>
  );
}
