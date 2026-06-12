import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import { cPipeline } from "@/app/mongodb/queries/opportunity-queries";
import { Card, CardContent } from "@/components/ui/card";
import StageActions from "./components/StageActions";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";

export const metadata = {
  title: "Pipeline | ERP System",
  description: "Open opportunities by stage — the sales pipeline",
};

// Auth-gated (session headers) — never statically prerendered.
export const dynamic = "force-dynamic";

const STAGE_LABEL = {
  qualification: "Qualification",
  needs_analysis: "Needs analysis",
  proposal: "Proposal",
  negotiation: "Negotiation",
};

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default async function PipelinePage() {
  // Page-level auth (defense in depth) + role gate — see leads/page.jsx.
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSalesNav(session.user.role))
    return <AccessDenied resource="the sales pipeline" />;

  const { columns, totals } = await cPipeline();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Open deals by stage. Weighted = value × win-probability.
          </p>
        </div>
        <div className="flex gap-4 text-right text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Open deals
            </div>
            <div className="font-semibold">{totals.count}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Pipeline value
            </div>
            <div className="font-semibold">{KES(totals.total)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Weighted forecast
            </div>
            <div className="font-semibold text-primary">{KES(totals.weighted)}</div>
          </div>
        </div>
      </div>

      {totals.count === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No open opportunities. Convert a qualified lead to start the pipeline.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((col) => (
            <div key={col.stage} className="flex flex-col">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium">
                  {STAGE_LABEL[col.stage] || col.stage}
                </span>
                <span className="text-xs text-muted-foreground">{col.count}</span>
              </div>
              <div className="mb-2 px-1 text-xs text-muted-foreground">
                {KES(col.total)} · wtd {KES(col.weighted)}
              </div>

              <div className="flex flex-col gap-2">
                {col.deals.map((d) => (
                  <Card key={d._id} className="bg-card border-border">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/dashboard/opportunities/${d._id}`}
                          className="font-medium leading-tight hover:text-primary hover:underline"
                        >
                          {d.name}
                        </Link>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {d.probability}%
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {d.account.name} · {d.opportunityNumber}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-semibold">{KES(d.amount)}</span>
                        <span className="text-xs text-muted-foreground">
                          wtd {KES(d.weightedAmount)}
                        </span>
                      </div>
                      {d.owner.name && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {d.owner.name}
                        </div>
                      )}
                      <StageActions opportunityId={d._id} stage={d.stage} />
                    </CardContent>
                  </Card>
                ))}
                {col.deals.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
