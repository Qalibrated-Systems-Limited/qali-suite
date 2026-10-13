import Link from "next/link";
import { Suspense } from "react";
import { getWorkspaceContext } from "../../projects/lib/workspace";
import AccessDenied from "../../projects/components/AccessDenied";
import NoProjectsCard from "../../projects/components/NoProjectsCard";
import ProjectSwitcher from "../../projects/components/ProjectSwitcher";
import { hasRole, WORKFLOW_REPORT_WRITE_ROLES } from "@/lib/utils/role-gates";
import { workCategories, resolveCategory, sheetsInCategory, CATEGORY_META } from "../lib/meta";
import { ChevronLeft } from "lucide-react";

export const metadata = {
  title: "Choose the sheet | Technical",
  description: "Pick a type of work, then the report sheet to start a new report",
};

export default async function ChooseSheetPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const canManage = hasRole(user, WORKFLOW_REPORT_WRITE_ROLES);
  const projectQ = project ? `&project=${project.id}` : "";
  const projectHomeQ = project ? `?project=${project.id}` : "";

  // Step 2 when a valid discipline is chosen via ?work=, else step 1 (cards).
  const activeCategory = resolveCategory(sp?.work);
  const sheets = activeCategory ? sheetsInCategory(activeCategory) : [];

  return (
    <>
      <div className="tech-bar">
        <span className="tech-bar-title">
          {activeCategory ? activeCategory : "Start a new report"}
          {project ? <span className="count">{project.name}</span> : null}
        </span>
        <span className="tech-bar-spacer" />
        <Suspense fallback={null}>
          <ProjectSwitcher projects={projects} selectedId={project?.id} />
        </Suspense>
      </div>

      <div className="tech-wrap">
        {!project && <NoProjectsCard />}

        {project && !canManage && <AccessDenied />}

        {/* STEP 1 — pick the type of work */}
        {project && canManage && !activeCategory && (
          <>
            <p className="tech-section-label">Choose the type of work</p>
            <p className="tech-lead">Pick the kind of job you are on — then choose the exact report.</p>
            <div className="tech-work-cards">
              {workCategories().map((c) => (
                <Link
                  key={c.category}
                  href={`/dashboard/technical/new?work=${encodeURIComponent(c.category)}${projectQ}`}
                  className="tech-work-card"
                >
                  <span className="tech-work-icon" aria-hidden>{c.icon}</span>
                  <span className="tech-work-body">
                    <span className="tech-work-name">{c.category}</span>
                    <span className="tech-work-blurb">{c.blurb}</span>
                  </span>
                  <span className="tech-work-count">
                    {c.count} report{c.count === 1 ? "" : "s"}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* STEP 2 — pick the sheet within the chosen work type */}
        {project && canManage && activeCategory && (
          <>
            <Link href={`/dashboard/technical/new${projectHomeQ}`} className="tech-back-link">
              <ChevronLeft size={15} strokeWidth={2.5} />
              All types of work
            </Link>
            <p className="tech-section-label" style={{ marginTop: 10 }}>
              <span style={{ marginRight: 8 }} aria-hidden>{CATEGORY_META[activeCategory]?.icon || "📄"}</span>
              {activeCategory}
            </p>
            <p className="tech-lead">Pick the report that matches what you are doing today.</p>
            <div className="tech-sheets">
              {sheets.map((s) => (
                <Link
                  key={s.code}
                  href={`/dashboard/technical/create?sheet=${s.code}${projectQ}`}
                  className="tech-sheet"
                >
                  <div className="tech-sheet-head">
                    <span className="tech-sheet-name">{s.name}</span>
                    <span className="tech-sheet-code">{s.code}</span>
                  </div>
                  <p className="tech-sheet-blurb">{s.blurb}</p>
                  <span className="tech-sheet-by">Filled by: {s.filledBy}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
