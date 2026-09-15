import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { can } from "@/lib/capabilities";
import { getKpiByIdPg, getKpiOwnerCandidatesPg } from "@/app/db/actions/kpi-actions";
import KpiForm from "../../components/KpiForm";

export const metadata = { title: "Edit KPI" };

// The list lives in lib/capabilities.js; it used to live here, and in
// three sibling pages, and in kpi-actions.ts — five copies of one rule.

export default async function EditKpiPage(props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "kpi.manage")) redirect("/dashboard/kpis");

  const params = await props.params;
  const [kpi, ownerCandidates] = await Promise.all([
    getKpiByIdPg(params.id),
    getKpiOwnerCandidatesPg(),
  ]);
  if (!kpi) notFound();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <Link
          href={`/dashboard/kpis/${kpi._id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to KPI
        </Link>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">Edit {kpi.name}</h1>
        <p className="text-sm text-muted-foreground">
          Editing the target affects new snapshots only — historical snapshots keep the target they were recorded against.
        </p>
      </div>

      <KpiForm mode="edit" kpi={kpi} ownerCandidates={ownerCandidates} />
    </div>
  );
}
