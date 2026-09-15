import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Target } from "lucide-react";
import { listKpisPg } from "@/app/db/actions/kpi-actions";
import { roleAllowed } from "@/lib/permissions";
import { can } from "@/lib/capabilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import KpiListCards from "./components/KpiListCards";
import KpiTemplatesDialog from "./components/KpiTemplatesDialog";

export const metadata = { title: "KPIs" };

// CEO became Viewer (0039) on READ gates, and is dropped from write gates.
// The list lives in lib/capabilities.js; it used to live here, and in
// three sibling pages, and in kpi-actions.ts — five copies of one rule.

async function KpiListLoader({ canManage }) {
  const kpis = await listKpisPg({ includeInactive: false });

  if (kpis.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Target className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">No KPIs defined yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Track progress against targets — start with revenue, cash, or any number your team should hit each month.
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <KpiTemplatesDialog triggerLabel="Use starter templates" triggerVariant="default" triggerSize="default" />
              <Button asChild variant="outline">
                <Link href="/dashboard/kpis/create">
                  <Plus className="h-4 w-4" /> Create from scratch
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return <KpiListCards kpis={kpis} canManage={canManage} />;
}

export default async function KpisIndex() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "kpi.view")) redirect("/dashboard");

  const canManage = can(session.user.role, "kpi.manage");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">KPIs</h1>
          <p className="text-sm text-muted-foreground">
            Targets, actuals, and trends across the business.
          </p>
        </div>
        {canManage && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <KpiTemplatesDialog triggerLabel="Templates" />
            <Button asChild size="sm">
              <Link href="/dashboard/kpis/create">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New KPI
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Suspense fallback={<KpiListSkeleton />}>
        <KpiListLoader canManage={canManage} />
      </Suspense>
    </div>
  );
}

function KpiListSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 rounded-lg border border-border bg-muted/30 animate-pulse" />
      ))}
    </div>
  );
}
