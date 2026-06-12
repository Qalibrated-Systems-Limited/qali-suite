import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { roleAllowed } from "@/lib/permissions";
import { getKpiOwnerCandidates } from "@/app/mongodb/queries/kpi-queries";
import KpiForm from "../components/KpiForm";

export const metadata = { title: "New KPI" };

const MANAGE_ROLES = ["SuperAdmin", "Admin", "CEO", "Manager", "CFO", "HR"];

export default async function CreateKpiPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, MANAGE_ROLES)) redirect("/dashboard/kpis");

  // Empty array if HR isn't set up — the form falls back to free-text name.
  const ownerCandidates = await getKpiOwnerCandidates();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <Link
          href="/dashboard/kpis"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to KPIs
        </Link>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">New KPI</h1>
        <p className="text-sm text-muted-foreground">
          Define a metric with a target. Add actuals month-by-month, or let auto-compute fill them in for supported sources.
        </p>
      </div>

      <KpiForm mode="create" ownerCandidates={ownerCandidates} />
    </div>
  );
}
