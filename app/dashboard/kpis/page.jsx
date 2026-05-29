import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Target } from "lucide-react";
import { listKpis } from "@/app/mongodb/queries/kpi-queries";
import { roleAllowed } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import KpiListCards from "./components/KpiListCards";

export const metadata = { title: "KPIs" };

const VIEW_ROLES = ["SuperAdmin", "Admin", "Manager", "CFO", "HR", "Accountant", "Finance Manager"];
const MANAGE_ROLES = ["SuperAdmin", "Admin", "Manager", "CFO", "HR"];

async function KpiListLoader({ canManage }) {
  const kpis = await listKpis({ includeInactive: false });

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
            <Button asChild>
              <Link href="/dashboard/kpis/create">
                <Plus className="h-4 w-4" /> Create your first KPI
              </Link>
            </Button>
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
  if (!roleAllowed(session.user.role, VIEW_ROLES)) redirect("/dashboard");

  const canManage = roleAllowed(session.user.role, MANAGE_ROLES);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">KPIs</h1>
          <p className="text-sm text-muted-foreground">
            Targets, actuals, and trends across the business.
          </p>
        </div>
        {canManage && (
          <Button asChild size="sm">
            <Link href="/dashboard/kpis/create">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New KPI
            </Link>
          </Button>
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
