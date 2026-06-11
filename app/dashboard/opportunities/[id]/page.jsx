import Link from "next/link";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import { ArrowLeft } from "lucide-react";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cOpportunity } from "@/app/mongodb/queries/opportunity-queries";
import { cTimeline } from "@/app/mongodb/queries/activity-queries";
import ActivityTimeline from "@/app/dashboard/components/crm/ActivityTimeline";
import ActivityComposer from "@/app/dashboard/components/crm/ActivityComposer";
import StageActions from "../components/StageActions";

const STAGE_LABEL = {
  qualification: "Qualification",
  needs_analysis: "Needs analysis",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed — Won",
  closed_lost: "Closed — Lost",
};

const STAGE_STYLE = (stage) =>
  stage === "closed_won"
    ? "bg-emerald-500/10 text-emerald-600"
    : stage === "closed_lost"
      ? "bg-destructive/10 text-destructive"
      : "bg-primary/10 text-primary";

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—";

export default async function OpportunityDetailPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSalesNav(session.user.role))
    return <AccessDenied resource="opportunities" />;

  const { id } = await params;
  const opp = await cOpportunity(id);
  if (!opp) notFound();

  const activities = await cTimeline("Opportunity", id);
  const isOpen = opp.stage !== "closed_won" && opp.stage !== "closed_lost";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/opportunities"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{opp.name}</h1>
            <p className="text-xs text-muted-foreground">
              {opp.opportunityNumber} · {opp.account.name}
            </p>
          </div>
        </div>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLE(
            opp.stage,
          )}`}
        >
          {STAGE_LABEL[opp.stage] || opp.stage}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Details */}
        <div className="space-y-4 lg:col-span-1">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm">Deal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Value" value={KES(opp.amount)} />
              <Row label="Probability" value={`${opp.probability}%`} />
              <Row label="Weighted" value={KES(opp.weightedAmount)} />
              <Row label="Expected close" value={fmtDate(opp.expectedCloseDate)} />
              <Row label="Owner" value={opp.owner?.name || "—"} />
              <Row label="Source" value={opp.source || "—"} />
              {opp.primaryContact?.name && (
                <Row label="Contact" value={opp.primaryContact.name} />
              )}
              {opp.leadRef?.leadId && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">From lead</span>
                  <Link
                    href={`/dashboard/leads/${opp.leadRef.leadId}`}
                    className="text-primary hover:underline"
                  >
                    {opp.leadRef.leadNumber}
                  </Link>
                </div>
              )}
              {opp.stage === "closed_lost" && (
                <Row label="Lost reason" value={opp.lostReason || "—"} />
              )}
            </CardContent>
          </Card>

          {isOpen && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">Move deal</CardTitle>
              </CardHeader>
              <CardContent>
                <StageActions opportunityId={opp._id} stage={opp.stage} />
              </CardContent>
            </Card>
          )}

          {opp.stage === "closed_won" && opp.wonDetails?.quoteId && (
            <Card className="bg-card border-border">
              <CardContent className="p-4 text-sm">
                Won — handed off to{" "}
                <Link
                  href={`/dashboard/quotes/${opp.wonDetails.quoteId}`}
                  className="font-medium text-primary hover:underline"
                >
                  draft quote →
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Stage history — the velocity trail */}
          {opp.stageHistory.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">Stage history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs">
                {opp.stageHistory.map((h, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="capitalize">
                      {STAGE_LABEL[h.stage] || h.stage}
                    </span>
                    <span className="text-muted-foreground">{fmtDate(h.at)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-4 lg:col-span-2">
          <ActivityComposer relatedKind="Opportunity" relatedId={opp._id} />
          <ActivityTimeline activities={activities} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
