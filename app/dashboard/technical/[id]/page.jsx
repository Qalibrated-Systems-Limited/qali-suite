import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import AccessDenied from "../../projects/components/AccessDenied";
import TechnicalReportActions from "../components/TechnicalReportActions";
import { getWorkflowReport, listReportSignoffUsers } from "@/app/db/actions/workflow-report-actions";
import { getProjectById } from "@/app/db/actions/project-actions";
import { canSeeProjectsNav } from "@/lib/permissions";
import { hasRole, WORKFLOW_REPORT_WRITE_ROLES, WORKFLOW_REPORT_SIGNOFF_ROLES } from "@/lib/utils/role-gates";
import { sheetName, displaySerial } from "../lib/meta";
import { templateByCode } from "../lib/templates";
import SheetDataView from "../components/SheetDataView";
import PdfPreviewButton from "@/components/pdf/PdfPreviewButton";
import { PaperCard, SectionBar, Pill, IdChip, COAL, GOLD, INK, MUTE, PASS, FAIL, WAIT } from "../components/ui";

export const metadata = { title: "Report | Technical" };

/**
 * One report, laid out as the Workflow Reports app's report screen: the paper
 * card between hazard stripes, the coal serial chip and the PDF buttons, the
 * sheet name with its status pill, the Client / Site / Weighbridge chips, the
 * approval route and review panels, the filled sheet, and the activity and
 * approval trail with its coloured action badges.
 */
export default async function ReportDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || !canSeeProjectsNav(session.user.role)) return <AccessDenied />;

  const report = await getWorkflowReport(id);
  if (!report) notFound();

  const project = await getProjectById(report.projectId);
  const template = templateByCode(report.type);
  const canManage = hasRole(session.user, WORKFLOW_REPORT_WRITE_ROLES);
  const canSignOff = hasRole(session.user, WORKFLOW_REPORT_SIGNOFF_ROLES);
  const signoffUsers = canManage || canSignOff ? await listReportSignoffUsers().catch(() => []) : [];

  const serial = displaySerial(report.reportNumber);
  const header = report.data?.header || {};
  const returned = report.status === "draft" ? report.data?.returned : null;
  const isWeighing = template?.category === "Weighing & Metrology";
  const reportDate = report.periodStart || report.createdAt;

  const trail = [
    ["Created", report.createdByName, report.createdAt],
    ["Submitted", report.submittedByName, report.submittedAt],
    ["Signed off", report.reviewedByName, report.reviewedAt],
    ["Approved", report.approvedByName, report.approvedAt],
  ].filter(([, , at]) => at);
  if (report.data?.returned) {
    trail.push(["Returned", report.data.returned.byName, report.data.returned.at, report.data.returned.comment]);
  }
  trail.sort((a, b) => new Date(a[2]) - new Date(b[2]));

  return (
    <div className="app-content">
      <Link href={`/dashboard/technical?project=${report.projectId}`} style={{ background: "none", border: 0, color: WAIT, fontWeight: 700, fontSize: 13, textDecoration: "none", display: "inline-block", margin: "12px 0 8px" }}>
        ← Report registry
      </Link>

      <PaperCard>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700, background: COAL, color: GOLD, padding: "4px 8px" }}>
            {serial}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PdfPreviewButton href={`/api/technical/${report._id}/pdf`} title={`${serial} — ${report.title}`} className="btn" label="Preview PDF" />
            <a className="btn btn-dark" href={`/api/technical/${report._id}/pdf?download=1`} style={{ fontSize: 12 }}>
              Download PDF
            </a>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 10 }}>
          <h1 className="h1">{sheetName(report.type)}</h1>
          <Pill status={report.status} />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <IdChip label="Client" value={header.client || "—"} />
          <IdChip label="Site / branch" value={header.site || "—"} />
          {isWeighing ? (
            <IdChip label="Weighbridge" value={header.weighbridge || "not stated"} mono />
          ) : (
            <IdChip label="Project" value={project ? `${project.projectNumber} · ${project.name}` : "—"} />
          )}
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          by <b>{report.createdByName}</b> · {new Date(reportDate).toLocaleDateString("en-GB")}
          {project && isWeighing ? (
            <>
              {" "}
              · <Link href={`/dashboard/projects/${project.id}`}>{project.projectNumber} · {project.name}</Link>
            </>
          ) : null}
        </div>

        {returned && (
          <div className="card" style={{ borderColor: FAIL, background: "#fdf1ef", padding: 14, marginTop: 14 }}>
            <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 12, color: FAIL, letterSpacing: ".04em" }}>
              Returned to the author
            </div>
            <div style={{ fontSize: 14, color: INK, marginTop: 6 }}>“{returned.comment}”</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              — {returned.byName}
              {returned.at ? ` · ${new Date(returned.at).toLocaleString("en-GB")}` : ""}
            </div>
          </div>
        )}

        <TechnicalReportActions
          report={report}
          project={project}
          authorName={session.user?.name || ""}
          canManage={canManage}
          canSignOff={canSignOff}
          currentUserId={session.user.id}
          signoffUsers={signoffUsers}
        />

        {template ? (
          <SheetDataView template={template} data={report.data} />
        ) : (
          [
            ["Summary", report.summary],
            ["Work completed / findings", report.workCompleted],
            ["Issues & faults", report.issues],
            ["Next steps / parts", report.nextSteps],
          ]
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => (
              <div key={k} style={{ fontSize: 14, marginTop: 8, whiteSpace: "pre-wrap" }}>
                <b style={{ textTransform: "uppercase", fontSize: 11, color: MUTE }}>{k}: </b>
                {v}
              </div>
            ))
        )}

        <SectionBar>Activity &amp; approval trail</SectionBar>
        {trail.map(([action, byName, at, comment], i) => {
          const a = action.toLowerCase();
          const color = a.includes("return") ? FAIL : a.includes("approv") || a.includes("signed") ? PASS : a.includes("submit") ? WAIT : MUTE;
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "8px 0", borderBottom: "1px solid #eae4d6", alignItems: "flex-start" }}>
              <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".03em", color: "#fff", background: color, padding: "2px 6px", borderRadius: 3, flexShrink: 0 }}>
                  {action}
                </span>
                <span style={{ color: INK }}>
                  by <b>{byName || "—"}</b>
                  {comment ? ` — "${comment}"` : ""}
                </span>
              </span>
              <span className="muted" style={{ flexShrink: 0, fontSize: 12 }}>
                {new Date(at).toLocaleString("en-GB")}
              </span>
            </div>
          );
        })}
        {report.status === "approved" && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 2, fontWeight: 900, textTransform: "uppercase", color: "#fff", background: PASS, textAlign: "center" }}>
            Approved — record closed
          </div>
        )}
      </PaperCard>
    </div>
  );
}
