import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import AccessDenied from "../../projects/components/AccessDenied";
import TechnicalReportActions from "../components/TechnicalReportActions";
import { getWorkflowReport } from "@/app/db/actions/workflow-report-actions";
import { getProjectById } from "@/app/db/actions/project-actions";
import { canSeeProjectsNav } from "@/lib/permissions";
import {
  hasRole,
  WORKFLOW_REPORT_WRITE_ROLES,
  WORKFLOW_REPORT_SIGNOFF_ROLES,
} from "@/lib/utils/role-gates";
import { ArrowLeft, ArrowUpRight, Check, Clock, Download } from "lucide-react";
import { STATUS_CONFIG, sheetName, displaySerial, fmtDate, fmtMoney } from "../lib/meta";
import { templateByCode } from "../lib/templates";
import SheetDataView from "../components/SheetDataView";

export const metadata = { title: "Report | Technical" };

function Section({ title, body }) {
  if (!body || !String(body).trim()) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 13, fontWeight: 800, margin: "0 0 4px" }}>{title}</h3>
      <p className="tech-muted" style={{ fontSize: 13.5, whiteSpace: "pre-wrap", margin: 0 }}>
        {body}
      </p>
    </div>
  );
}

function TL({ done, label, who, when }) {
  return (
    <div className="tech-timeline-row" style={{ marginBottom: 14 }}>
      <div className={`tech-timeline-dot ${done ? "done" : ""}`}>
        {done ? <Check size={13} /> : <Clock size={13} />}
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, opacity: done ? 1 : 0.7 }}>{label}</p>
        <p className="tech-muted" style={{ fontSize: 11.5, margin: 0 }}>
          {done ? `${who || "—"} · ${fmtDate(when)}` : "Pending"}
        </p>
      </div>
    </div>
  );
}

export default async function ReportDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || !canSeeProjectsNav(session.user.role)) return <AccessDenied />;

  const report = await getWorkflowReport(id);
  if (!report) notFound();

  const project = await getProjectById(report.projectId);
  const st = STATUS_CONFIG[report.status] || STATUS_CONFIG.draft;
  const template = templateByCode(report.type);
  const canManage = hasRole(session.user, WORKFLOW_REPORT_WRITE_ROLES);
  const canSignOff = hasRole(session.user, WORKFLOW_REPORT_SIGNOFF_ROLES);
  const hasSnapshot =
    report.snapshotProgress != null || report.snapshotRevenue != null || report.snapshotCost != null;

  return (
    <>
      <div className="tech-bar">
        <Link href={`/dashboard/technical?project=${report.projectId}`} className="tech-btn-ghost">
          <ArrowLeft size={14} />
          Registry
        </Link>
        <span className="tech-serial" style={{ margin: "0 0 0 6px" }}>
          {displaySerial(report.reportNumber)}
        </span>
        <span className="tech-bar-title">{sheetName(report.type)}</span>
        <span className="tech-chip" style={{ background: st.color }}>
          {st.label}
        </span>
        <span className="tech-bar-spacer" />
        <a
          href={`/api/technical/${report._id}/pdf`}
          className="tech-btn-gold"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={14} />
          Download PDF
        </a>
        {project && (
          <Link href={`/dashboard/projects/${project.id}`} className="tech-btn-ghost">
            Full project
            <ArrowUpRight size={13} />
          </Link>
        )}
      </div>

      <div className="tech-wrap" style={{ maxWidth: 1180 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: "2px 0 4px" }}>{report.title}</h1>
        {project && (
          <p className="tech-muted" style={{ fontSize: 13, margin: "0 0 16px" }}>
            <span style={{ fontFamily: "ui-monospace, monospace" }}>{project.projectNumber}</span> ·{" "}
            {project.name}
          </p>
        )}

        <TechnicalReportActions
          report={report}
          project={project}
          authorName={session.user?.name || ""}
          canManage={canManage}
          canSignOff={canSignOff}
        />

        <div className="tech-detail-grid" style={{ marginTop: 16 }}>
          <div className="tech-panel">
            {template ? (
              <SheetDataView template={template} data={report.data} />
            ) : (
              <>
                {report.periodStart || report.periodEnd ? (
                  <p className="tech-muted" style={{ fontSize: 13, marginTop: 0 }}>
                    Reporting period:{" "}
                    <strong>
                      {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}
                    </strong>
                  </p>
                ) : null}
                <Section title="Summary" body={report.summary} />
                <Section title="Work completed / findings" body={report.workCompleted} />
                <Section title="Issues & faults" body={report.issues} />
                <Section title="Next steps / parts" body={report.nextSteps} />
              </>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="tech-panel">
              <h3 style={{ fontSize: 13, fontWeight: 800, margin: "0 0 12px" }}>Project snapshot</h3>
              {hasSnapshot ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <p className="tech-muted" style={{ fontSize: 11.5, margin: "0 0 4px" }}>
                      Schedule progress
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          height: 8,
                          flex: 1,
                          background: "var(--muted)",
                          borderRadius: 20,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${report.snapshotProgress ?? 0}%`,
                            background: "var(--tech-gold)",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, width: 36, textAlign: "right" }}>
                        {report.snapshotProgress ?? 0}%
                      </span>
                    </div>
                  </div>
                  <Row label="Invoiced" value={fmtMoney(report.snapshotRevenue)} />
                  <Row label="Supplier cost" value={fmtMoney(report.snapshotCost)} />
                </div>
              ) : (
                <p className="tech-muted" style={{ fontSize: 12, margin: 0 }}>
                  The project figures are captured when the report is submitted.
                </p>
              )}
            </div>

            <div className="tech-panel">
              <h3 style={{ fontSize: 13, fontWeight: 800, margin: "0 0 12px" }}>Review trail</h3>
              <TL done label="Created" who={report.createdByName} when={report.createdAt} />
              <TL done={Boolean(report.submittedAt)} label="Submitted" who={report.submittedByName} when={report.submittedAt} />
              <TL done={Boolean(report.reviewedAt)} label="Supervisor sign-off" who={report.reviewedByName} when={report.reviewedAt} />
              <TL done={Boolean(report.approvedAt)} label="Manager approval" who={report.approvedByName} when={report.approvedAt} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize: 13 }}>
      <span className="tech-muted">{label}</span>
      <span style={{ marginLeft: "auto", fontWeight: 700 }}>{value}</span>
    </div>
  );
}
