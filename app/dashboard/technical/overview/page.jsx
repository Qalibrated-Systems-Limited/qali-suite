import Link from "next/link";
import { auth } from "@/auth";
import AccessDenied from "../../projects/components/AccessDenied";
import { getTechnicalDashboard } from "@/app/db/actions/workflow-report-actions";
import { canSeeProjectsNav } from "@/lib/permissions";
import { sheetName, sheetCategory } from "../lib/meta";
import { Plus } from "lucide-react";

export const metadata = {
  title: "Dashboard | Technical",
  description: "Company-wide overview of Technical reports",
};

const STATUS_SEGMENTS = [
  { key: "submitted", label: "Supervisor review", color: "var(--tech-olive)" },
  { key: "reviewed", label: "Manager approval", color: "var(--tech-amber)" },
  { key: "approved", label: "Approved", color: "var(--tech-green)" },
  { key: "draft", label: "Draft", color: "var(--tech-slate)" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function lastSixMonths(byMonth) {
  const map = Object.fromEntries((byMonth || []).map((r) => [r.ym, r.count]));
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    out.push({ label: m.toLocaleDateString("en-GB", { month: "short" }), count: map[ym] || 0 });
  }
  return out;
}

export default async function TechnicalDashboardPage() {
  const session = await auth();
  if (!session?.user || !canSeeProjectsNav(session.user.role)) return <AccessDenied />;

  const stats = await getTechnicalDashboard();
  const t = stats.totals;
  const total = t.total || 0;

  // Donut conic-gradient stops
  let acc = 0;
  const stops = STATUS_SEGMENTS.map((s) => {
    const v = t[s.key] || 0;
    const start = total ? (acc / total) * 100 : 0;
    acc += v;
    const end = total ? (acc / total) * 100 : 0;
    return { ...s, v, start, end };
  });
  const gradient = total
    ? `conic-gradient(${stops.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(", ")})`
    : "conic-gradient(var(--muted) 0 100%)";

  const months = lastSixMonths(stats.byMonth);
  const maxMonth = Math.max(1, ...months.map((m) => m.count));

  const byType = (stats.byType || []).map((r) => ({ name: sheetName(r.type), count: r.count }));
  const maxType = Math.max(1, ...byType.map((r) => r.count));

  // Roll the per-sheet counts up to the project discipline (category).
  const catMap = {};
  for (const r of stats.byType || []) {
    const cat = sheetCategory(r.type);
    catMap[cat] = (catMap[cat] || 0) + (r.count || 0);
  }
  const byCategory = Object.entries(catMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const maxCat = Math.max(1, ...byCategory.map((r) => r.count));

  const firstName = (session.user.name || "there").split(" ")[0];

  return (
    <>
      <div className="tech-bar">
        <span className="tech-bar-title">
          Dashboard
          <span className="count">Live overview</span>
        </span>
        <span className="tech-bar-spacer" />
        <Link href="/dashboard/technical/new" className="tech-btn-gold">
          <Plus size={14} strokeWidth={3} />
          New report
        </Link>
      </div>

      <div className="tech-wrap">
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: "0 0 2px", textTransform: "uppercase" }}>
          {greeting()}, {firstName}
        </h1>
        <p className="tech-lead">A company-wide view of every Technical report.</p>

        <div className="tech-dash">
          {/* Report status ring */}
          <div className="tech-panel">
            <div className="tech-sectionbar" style={{ marginTop: 0 }}>Report status</div>
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              <div className="tech-donut" style={{ background: gradient }}>
                <div className="tech-donut-hole">
                  <span className="n">{total}</span>
                  <span className="l">reports</span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                {stops.map((s) => (
                  <div key={s.key} className="tech-legend-row">
                    <span className="dot" style={{ background: s.color }} />
                    <span className="lab">{s.label}</span>
                    <span className="val">{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Reports by month */}
          <div className="tech-panel">
            <div className="tech-sectionbar" style={{ marginTop: 0 }}>Reports · by month</div>
            <div className="tech-monthbars">
              {months.map((m, i) => (
                <div key={i} className="col">
                  <span className="cnt">{m.count}</span>
                  <div className="bar" style={{ height: `${Math.round((m.count / maxMonth) * 120) + 2}px` }} />
                  <span className="ml">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By form type */}
          <div className="tech-panel">
            <div className="tech-sectionbar" style={{ marginTop: 0 }}>By form type</div>
            {byType.length === 0 ? (
              <p className="tech-muted" style={{ fontSize: 13 }}>No reports yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {byType.map((r) => (
                  <div key={r.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                      <span>{r.name}</span>
                      <span style={{ fontWeight: 800 }}>{r.count}</span>
                    </div>
                    <div className="tech-hbar">
                      <div className="fill" style={{ width: `${Math.round((r.count / maxType) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By discipline (project category) */}
          <div className="tech-panel">
            <div className="tech-sectionbar" style={{ marginTop: 0 }}>By discipline</div>
            {byCategory.length === 0 ? (
              <p className="tech-muted" style={{ fontSize: 13 }}>No reports yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {byCategory.map((r) => (
                  <div key={r.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                      <span>{r.name}</span>
                      <span style={{ fontWeight: 800 }}>{r.count}</span>
                    </div>
                    <div className="tech-hbar">
                      <div className="fill" style={{ width: `${Math.round((r.count / maxCat) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
