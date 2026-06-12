import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { roleAllowed } from "@/lib/permissions";
import { getKpiWithSnapshots } from "@/app/mongodb/queries/kpi-queries";
import { Button } from "@/components/ui/button";
import KpiDetailView from "./KpiDetailView";

export const metadata = { title: "KPI Detail" };

const VIEW_ROLES = ["SuperAdmin", "Admin", "CEO", "Manager", "CFO", "HR", "Accountant", "Finance Manager"];
const MANAGE_ROLES = ["SuperAdmin", "Admin", "CEO", "Manager", "CFO", "HR"];
const ENTER_ROLES = ["SuperAdmin", "Admin", "Manager", "CFO", "HR", "Accountant"];

export default async function KpiDetailPage(props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, VIEW_ROLES)) redirect("/dashboard");

  const params = await props.params;
  const kpi = await getKpiWithSnapshots(params.id, { limit: 24 });
  if (!kpi) notFound();

  const canManage = roleAllowed(session.user.role, MANAGE_ROLES);
  const canEnter = roleAllowed(session.user.role, ENTER_ROLES);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/dashboard/kpis"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to KPIs
          </Link>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">{kpi.name}</h1>
          {kpi.description && <p className="mt-1 text-sm text-muted-foreground">{kpi.description}</p>}
        </div>
        {canManage && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/kpis/${kpi._id}/edit`}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit definition
            </Link>
          </Button>
        )}
      </div>

      <KpiDetailView kpi={kpi} canManage={canManage} canEnter={canEnter} />
    </div>
  );
}
