import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { roleAllowed } from "@/lib/permissions";
import { getKpiById, getKpiOwnerCandidates } from "@/app/mongodb/queries/kpi-queries";
import KpiForm from "../../components/KpiForm";

export const metadata = { title: "Edit KPI" };

const MANAGE_ROLES = ["SuperAdmin", "Admin", "CEO", "Manager", "CFO", "HR"];

export default async function EditKpiPage(props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, MANAGE_ROLES)) redirect("/dashboard/kpis");

  const params = await props.params;
  const [kpi, ownerCandidates] = await Promise.all([
    getKpiById(params.id),
    getKpiOwnerCandidates(),
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
