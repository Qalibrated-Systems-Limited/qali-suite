import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { can } from "@/lib/capabilities";
import { getKpiOwnerCandidatesPg } from "@/app/db/actions/kpi-actions";
import KpiForm from "../components/KpiForm";

export const metadata = { title: "New KPI" };

// The list lives in lib/capabilities.js; it used to live here, and in
// three sibling pages, and in kpi-actions.ts — five copies of one rule.

export default async function CreateKpiPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "kpi.manage")) redirect("/dashboard/kpis");

  // Empty array if HR isn't set up — the form falls back to free-text name.
  const ownerCandidates = await getKpiOwnerCandidatesPg();

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
