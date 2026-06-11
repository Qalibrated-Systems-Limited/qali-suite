import Link from "next/link";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import { ArrowLeft } from "lucide-react";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cLead } from "@/app/mongodb/queries/lead-queries";
import { cTimeline } from "@/app/mongodb/queries/activity-queries";
import ActivityTimeline from "@/app/dashboard/components/crm/ActivityTimeline";
import ActivityComposer from "@/app/dashboard/components/crm/ActivityComposer";
import LeadRowActions from "../components/LeadRowActions";

const STATUS_STYLES = {
  new: "bg-blue-500/10 text-blue-600",
  contacted: "bg-amber-500/10 text-amber-600",
  qualified: "bg-emerald-500/10 text-emerald-600",
  unqualified: "bg-muted text-muted-foreground",
  converted: "bg-primary/10 text-primary",
};

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default async function LeadDetailPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSalesNav(session.user.role)) return <AccessDenied resource="leads" />;

  const { id } = await params;
  const lead = await cLead(id);
  if (!lead) notFound();

  const activities = await cTimeline("Lead", id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/leads"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{lead.name}</h1>
            <p className="text-xs text-muted-foreground">
              {lead.leadNumber}
              {lead.company ? ` · ${lead.company}` : ""}
            </p>
          </div>
        </div>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
            STATUS_STYLES[lead.status] || "bg-muted"
          }`}
        >
          {lead.status}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Details */}
        <div className="space-y-4 lg:col-span-1">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Email" value={lead.email || "—"} />
              <Row label="Phone" value={lead.phone || "—"} />
              <Row label="Title" value={lead.title || "—"} />
              <Row label="Source" value={lead.source?.replace(/_/g, " ")} />
              <Row label="Est. value" value={KES(lead.estimatedValue)} />
              <Row label="Owner" value={lead.owner?.name || "—"} />
              {lead.status === "unqualified" && lead.lostReason && (
                <Row label="Lost reason" value={lead.lostReason} />
              )}
              {lead.notes && (
                <div className="pt-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Notes
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{lead.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {lead.status === "converted" && lead.convertedTo?.opportunityId ? (
            <Card className="bg-card border-border">
              <CardContent className="p-4 text-sm">
                Converted to{" "}
                <Link
                  href={`/dashboard/opportunities/${lead.convertedTo.opportunityId}`}
                  className="font-medium text-primary hover:underline"
                >
                  opportunity →
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <LeadRowActions leadId={lead._id} status={lead.status} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-4 lg:col-span-2">
          <ActivityComposer relatedKind="Lead" relatedId={lead._id} />
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
      <span className="text-right capitalize">{value}</span>
    </div>
  );
}
