import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccessDenied from "../../projects/components/AccessDenied";
import { getTechnicalTickets } from "@/app/db/actions/technical-actions";
import { technicalViewer } from "../lib/access";
import TicketsTable from "./TicketsTable";

export const metadata = {
  title: "Service tickets | Technical",
  description: "Help desk tickets for the technical team — assign, work and resolve them",
};

/**
 * Help desk calls that need a technician. The desk logs them; a technical
 * manager gives each to someone on the team here; the technician works it from
 * here, from My work or from Tasks, and resolves it — the help desk sees every
 * step, because it is the same ticket.
 */
export default async function TechnicalTicketsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const viewer = await technicalViewer(session.user);
  if (!viewer.canView) return <AccessDenied />;
  const sp = (await searchParams) || {};
  const all = sp.scope === "all";
  const data = await getTechnicalTickets(all);

  return (
    <div className="tech-wrap">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 12 }}>
        <div>
          <p className="eyebrow">Technical</p>
          <h1 className="h1">Service tickets</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {data.me.isManager
              ? "Help desk tickets for the technical team. Give each to a technician; they are notified and it appears in their Tasks."
              : "Help desk tickets for the technical team. Work the ones assigned to you and resolve them here."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {data.me.isManager && (
            <Link className="tech-btn-ghost" href={all ? "/dashboard/technical/tickets" : "/dashboard/technical/tickets?scope=all"}>
              {all ? "Technical tickets only" : "Show every open ticket"}
            </Link>
          )}
          <Link className="tech-btn-ghost" href="/dashboard/helpdesk">Open Help Desk</Link>
        </div>
      </div>
      <TicketsTable tickets={data.tickets} team={data.team} me={data.me} />
    </div>
  );
}
