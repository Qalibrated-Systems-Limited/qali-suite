import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccessDenied from "../../projects/components/AccessDenied";
import { getMyWork, getTechnicalTeam } from "@/app/db/actions/technical-actions";
import { getMyReports } from "@/app/db/actions/workflow-report-actions";
import { getMyAssignments } from "@/app/db/actions/tasks-actions";
import { getResourceRequests } from "@/app/db/actions/resource-actions";
import { technicalViewer } from "../lib/access";
import { displaySerial, sheetName } from "../lib/meta";
import WorkActions, { StatusBadge } from "../components/WorkActions";

export const metadata = {
  title: "My work | Technical",
  description: "What is assigned to you, what came back, and what waits for your approval",
};

/**
 * One place for a technician's day and a technical manager's queue.
 *
 *   everyone:  calibration jobs and inspections assigned to me; my reports —
 *              drafts, returned to me, waiting on someone else
 *   managers:  reports waiting for MY signature, jobs and inspections
 *              awaiting approval, work nobody has been given, and the team's
 *              load per person
 */
export default async function MyWorkPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const viewer = await technicalViewer(session.user);
  if (!viewer.canView) return <AccessDenied />;

  const [work, reports, team, assignments] = await Promise.all([
    getMyWork(),
    getMyReports(),
    viewer.isManager ? getTechnicalTeam() : Promise.resolve([]),
    getMyAssignments(),
  ]);
  const resourceQueue = viewer.isManager
    ? (await getResourceRequests()).requests.filter((r) => r.status === "pending")
    : [];
  const myTickets = assignments.filter((a) => a.source === "ticket");
  const me = { userId: work.userId, isManager: work.isManager, isTechnician: work.isTechnician };

  const returnedReports = reports.mine.filter((r) => r.status === "draft" && r.data?.returned);
  const draftReports = reports.mine.filter((r) => r.status === "draft" && !r.data?.returned);
  const waitingReports = reports.mine.filter((r) => r.status !== "draft");
  const returnedWork = [
    ...work.jobs.filter((j) => j.status === "returned").map((j) => ({ kind: "job", item: j })),
    ...work.inspections.filter((i) => i.status === "returned").map((i) => ({ kind: "inspection", item: i })),
  ];
  const openWork = [
    ...work.jobs.filter((j) => j.status !== "returned").map((j) => ({ kind: "job", item: j })),
    ...work.inspections.filter((i) => i.status !== "returned").map((i) => ({ kind: "inspection", item: i })),
  ];
  const toApprove = [
    ...work.approvalJobs.map((j) => ({ kind: "job", item: j })),
    ...work.approvalInspections.map((i) => ({ kind: "inspection", item: i })),
  ];

  const needsMe =
    returnedReports.length + returnedWork.length + reports.toSign.length + myTickets.length +
    (me.isManager ? toApprove.length + resourceQueue.length : 0);

  return (
    <div className="tech-wrap">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 12 }}>
        <div>
          <p className="eyebrow">Technical</p>
          <h1 className="h1">My work</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {needsMe ? `${needsMe} item${needsMe === 1 ? "" : "s"} need${needsMe === 1 ? "s" : ""} you now.` : "Nothing is waiting on you."}
            {me.isManager ? " You are a technical manager: you assign work and approve results." : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="tech-btn-gold" href="/dashboard/technical/new">New report</Link>
          <Link className="tech-btn-ghost" href="/dashboard/calibration">Calibration</Link>
          <Link className="tech-btn-ghost" href="/dashboard/inspection">Inspection</Link>
          <Link className="tech-btn-ghost" href="/dashboard/technical/tickets">Service tickets</Link>
        </div>
      </div>

      {!me.isTechnician && (
        <div className="tech-alert" style={{ marginTop: 12 }}>
          You can read technical work but not carry it out. An administrator can set your department to
          Technical (Users → edit) to give you technician access.
        </div>
      )}

      {me.isManager && (
        <>
          <Section title="Resource requests waiting for you" count={resourceQueue.length}>
            {resourceQueue.length === 0 ? (
              <div className="tech-empty2">No technician, vehicle or equipment request is waiting.</div>
            ) : (
              <div className="tech-alert" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>
                  {resourceQueue.slice(0, 3).map((r) => `${r.requestNumber} ${r.resourceName} (${r.startDate})`).join(" · ")}
                  {resourceQueue.length > 3 ? ` · and ${resourceQueue.length - 3} more` : ""}
                </span>
                <Link href="/dashboard/technical/resources">Review and decide →</Link>
              </div>
            )}
          </Section>
          <Section title="Reports waiting for your signature" count={reports.toSign.length}>
            <ReportTable rows={reports.toSign} empty="No report is waiting for your signature." showBy />
          </Section>
          <Section title="Jobs & inspections awaiting approval" count={toApprove.length}>
            <WorkTable rows={toApprove} me={me} team={team} empty="Nothing is waiting for approval." />
          </Section>
          {(work.unassigned.jobs > 0 || work.unassigned.inspections > 0) && (
            <div className="tech-alert" style={{ marginTop: 12 }}>
              Not yet assigned: {work.unassigned.jobs} calibration job{work.unassigned.jobs === 1 ? "" : "s"} and{" "}
              {work.unassigned.inspections} inspection{work.unassigned.inspections === 1 ? "" : "s"}.{" "}
              <Link href="/dashboard/calibration">Assign jobs</Link> · <Link href="/dashboard/inspection">Assign inspections</Link>
            </div>
          )}
        </>
      )}

      <Section title="Returned to you" count={returnedReports.length + returnedWork.length} tone="red">
        {returnedReports.length + returnedWork.length === 0 ? (
          <div className="tech-empty2">Nothing has been returned to you.</div>
        ) : (
          <>
            {returnedReports.length > 0 && <ReportTable rows={returnedReports} empty="" showReason />}
            {returnedWork.length > 0 && <WorkTable rows={returnedWork} me={me} team={team} empty="" showReason />}
          </>
        )}
      </Section>

      <Section title="Assigned to you" count={openWork.length}>
        <WorkTable rows={openWork} me={me} team={team} empty="No calibration jobs or inspections are assigned to you." />
      </Section>

      <Section title="Help desk tickets assigned to you" count={myTickets.length}>
        {myTickets.length === 0 ? (
          <div className="tech-empty2">No help desk ticket is assigned to you.</div>
        ) : (
          <div className="tech-tablewrap">
            <table className="tech-table">
              <thead><tr><th>Ticket</th><th>Title</th><th>Category · client</th><th>Resolve by</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {myTickets.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.ref}</td>
                    <td>{t.title}</td>
                    <td>{t.detail}</td>
                    <td style={t.overdue ? { color: "#b91c1c", fontWeight: 700 } : undefined}>{fmt(t.dueDate)}{t.overdue ? " · overdue" : ""}</td>
                    <td><span className="tech-b blue">{t.status.replace("_", " ")}</span></td>
                    <td><Link className="tech-rowbtn" href={t.href}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Your draft reports" count={draftReports.length}>
        <ReportTable rows={draftReports} empty="No drafts. Start one from New report." />
      </Section>

      <Section title="Your reports waiting on others" count={waitingReports.length}>
        <ReportTable rows={waitingReports} empty="None of your reports is waiting for sign-off." showWaiting />
      </Section>

      {me.isManager && (
        <Section title="Team workload" count={work.team.length}>
          {work.team.length === 0 ? (
            <div className="tech-empty2">No work has been assigned to anyone yet.</div>
          ) : (
            <div className="tech-tablewrap">
              <table className="tech-table">
                <thead><tr><th>Technician</th><th>Open</th><th>Overdue</th><th>Awaiting approval</th></tr></thead>
                <tbody>
                  {work.team.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{t.open}</td>
                      <td style={t.overdue ? { color: "#b91c1c", fontWeight: 700 } : undefined}>{t.overdue}</td>
                      <td>{t.submitted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, tone, children }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 8px", display: "flex", gap: 8, alignItems: "center" }}>
        {title}
        <span className={`tech-b ${count ? (tone || "amber") : "slate"}`}>{count}</span>
      </h2>
      {children}
    </section>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

function ReportTable({ rows, empty, showReason, showWaiting, showBy }) {
  if (!rows.length) return empty ? <div className="tech-empty2">{empty}</div> : null;
  return (
    <div className="tech-tablewrap">
      <table className="tech-table">
        <thead>
          <tr>
            <th>Report</th><th>Sheet</th><th>Title</th>
            {showBy && <th>Submitted by</th>}
            {showWaiting && <th>Waiting for</th>}
            {showReason && <th>Why it came back</th>}
            <th>Updated</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{displaySerial(r.reportNumber)}</td>
              <td>{sheetName(r.type)}</td>
              <td>{r.title}</td>
              {showBy && <td>{r.submittedByName || "—"}</td>}
              {showWaiting && <td>{r.status === "submitted" ? r.assignedReviewerName || "Supervisor" : r.assignedApproverName || "Manager"}</td>}
              {showReason && <td style={{ color: "#b91c1c" }}>{r.data?.returned?.comment || "—"}</td>}
              <td>{fmt(r.updatedAt)}</td>
              <td><Link className="tech-rowbtn" href={`/dashboard/technical/${r.id}`}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkTable({ rows, me, team, empty, showReason }) {
  if (!rows.length) return empty ? <div className="tech-empty2">{empty}</div> : null;
  return (
    <div className="tech-tablewrap">
      <table className="tech-table">
        <thead>
          <tr>
            <th>No.</th><th>Kind</th><th>Client</th><th>Scheduled</th><th>Done by</th><th>Status</th>
            {showReason && <th>Why it came back</th>}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ kind, item }) => {
            const overdue =
              ["scheduled", "in_progress", "returned"].includes(item.status) &&
              item.scheduledDate && new Date(item.scheduledDate) < new Date(new Date().toDateString());
            return (
              <tr key={`${kind}-${item.id}`}>
                <td className="mono">{kind === "job" ? item.jobNumber : item.inspectionNumber}</td>
                <td>{kind === "job" ? `Calibration${item.serviceType ? ` · ${item.serviceType}` : ""}` : `Inspection${item.type ? ` · ${item.type}` : ""}`}</td>
                <td>{item.clientName}</td>
                <td style={overdue ? { color: "#b91c1c", fontWeight: 700 } : undefined}>
                  {fmt(item.scheduledDate)}{overdue ? " · overdue" : ""}
                </td>
                <td>{(kind === "job" ? item.technicianName : item.inspectorName) || "—"}</td>
                <td><StatusBadge status={item.status} /></td>
                {showReason && <td style={{ color: "#b91c1c" }}>{item.returnComment || "—"}</td>}
                <td>
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <WorkActions kind={kind} item={item} me={me} team={team} />
                    {kind === "job" && item.certNumber ? (
                      <a className="tech-rowbtn" href={`/api/technical/calibration/${item.id}/certificate`} target="_blank" rel="noreferrer">Certificate</a>
                    ) : null}
                    {kind === "inspection" ? (
                      <a className="tech-rowbtn" href={`/api/technical/inspection/${item.id}/report`} target="_blank" rel="noreferrer">Report</a>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
