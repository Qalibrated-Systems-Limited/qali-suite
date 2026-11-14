import Link from "next/link";
import { Suspense } from "react";
import { getWorkspaceContext } from "../../projects/lib/workspace";
import AccessDenied from "../../projects/components/AccessDenied";
import NoProjectsCard from "../../projects/components/NoProjectsCard";
import ProjectSwitcher from "../../projects/components/ProjectSwitcher";
import { hasRole, WORKFLOW_REPORT_WRITE_ROLES } from "@/lib/utils/role-gates";
import { sheetsByCategory, resolveCategory, CATEGORY_META } from "../lib/meta";
import { SectionBar, COAL, GOLD, INK, WAIT } from "../components/ui";

export const metadata = {
  title: "Choose the sheet | Technical",
  description: "Pick the report sheet to start a new report",
};

/**
 * "Choose the sheet", as the Workflow Reports app shows it: each sheet a card
 * with a hazard-striped edge, its name in heavy capitals, the coal code chip,
 * what it is for and who fills it. The app has eight sheets on one page; this
 * module has them for every kind of project, so the same cards sit under a
 * heading per kind of work, with the kinds as filter chips across the top.
 */
export default async function ChooseSheetPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const canManage = hasRole(user, WORKFLOW_REPORT_WRITE_ROLES);
  const projectQ = project ? `&project=${project.id}` : "";
  const active = resolveCategory(sp?.work);
  const groups = sheetsByCategory().filter((g) => !active || g.category === active);
  const chipHref = (work) =>
    `/dashboard/technical/new?${work ? `work=${encodeURIComponent(work)}` : ""}${projectQ}`.replace("?&", "?");

  return (
    <div className="app-content">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 12 }}>
        <div>
          <p className="eyebrow">Start a new report</p>
          <h1 className="h1">Choose the sheet</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Pick what you are doing today.
          </p>
        </div>
        <Suspense fallback={null}>
          <ProjectSwitcher projects={projects} selectedId={project?.id} />
        </Suspense>
      </div>

      {!project && <NoProjectsCard />}
      {project && !canManage && <AccessDenied />}

      {project && canManage && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 4px" }}>
            {[null, ...sheetsByCategory().map((g) => g.category)].map((c) => {
              const on = (c || null) === (active || null);
              return (
                <Link
                  key={c || "all"}
                  href={chipHref(c)}
                  className="btn"
                  style={on ? { background: COAL, color: GOLD, borderColor: COAL, fontSize: 12 } : { fontSize: 12 }}
                >
                  {c ? `${CATEGORY_META[c]?.icon || ""} ${c}`.trim() : "All sheets"}
                </Link>
              );
            })}
          </div>

          {groups.map((g) => (
            <div key={g.category}>
              <SectionBar>{g.category}</SectionBar>
              <div className="grid md-2">
                {g.sheets.map((t) => (
                  <Link
                    key={t.code}
                    href={`/dashboard/technical/create?sheet=${t.code}${projectQ}`}
                    className="card"
                    style={{ textAlign: "left", display: "flex", padding: 0, textDecoration: "none" }}
                  >
                    <div style={{ width: 6, flexShrink: 0, backgroundImage: `repeating-linear-gradient(45deg, ${GOLD} 0 6px, ${COAL} 6px 12px)` }} />
                    <div style={{ padding: 14, flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <span style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 14, color: INK }}>{t.name}</span>
                        <span className="mono" style={{ fontSize: 11, color: GOLD, background: COAL, padding: "2px 6px" }}>
                          {t.code}
                        </span>
                      </div>
                      <div className="muted" style={{ marginTop: 4 }}>
                        {t.blurb}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: WAIT, marginTop: 4 }}>Filled by: {t.filledBy}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
