import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { canSeeFinanceNav } from "@/lib/permissions";
import { getPettyCashReturnById } from "@/app/mongodb/queries/petty-cash-queries";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";
import Company from "@/app/models/Company";
import dbConnect from "@/app/config/dbConnect";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import PettyCashLedger from "../components/PettyCashLedger";
import PettyCashWorkflow from "../components/PettyCashWorkflow";

const CUSTODIAN_ROLES = new Set(["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"]);
const APPROVER_ROLES = new Set(["SuperAdmin", "Admin", "CEO", "CFO"]);

const STATUS_STYLES = {
  draft: "bg-zinc-100 text-zinc-700",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

const fmt = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default async function PettyCashReturnPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeFinanceNav(session.user.role)) redirect("/dashboard");

  const ret = await getPettyCashReturnById(id);
  if (!ret) notFound();

  const [projects] = await Promise.all([getActiveProjects()]);
  await dbConnect();
  const company = await Company.findById(ret.companyId).select("name tagline").lean();

  const role = session.user.role;
  const canEdit = CUSTODIAN_ROLES.has(role) && ret.status === "draft";
  const canApprove = APPROVER_ROLES.has(role) && ret.status === "submitted";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <Link href="/dashboard/petty-cash" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Petty cash
      </Link>

      {/* Header */}
      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{ret.documentNumber}</h1>
              <Badge className={`text-xs ${STATUS_STYLES[ret.status] || ""}`}>{ret.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ret.float?.accountName || "Petty Cash"} · {fmtDate(ret.period?.from)} – {fmtDate(ret.period?.to)}
              {ret.custodian?.name ? ` · ${ret.custodian.name}` : ""}
            </p>
          </div>
          <PettyCashWorkflow
            data={ret}
            company={company ? { name: company.name, tagline: company.tagline } : { name: "Company" }}
            canSubmit={canEdit}
            canApprove={canApprove}
          />
        </div>

        {ret.status === "rejected" || ret.rejectionReason ? (
          <p className="text-xs text-red-600">Sent back: {ret.rejectionReason}</p>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Opening float (b/f)</p>
            <p className="text-sm font-semibold">{fmt(ret.openingBalance)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Float in (DR)</p>
            <p className="text-sm font-semibold text-emerald-700">{fmt(ret.totals?.debits)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Spent (CR)</p>
            <p className="text-sm font-semibold text-red-600">{fmt(ret.totals?.credits)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Closing balance</p>
            <p className="text-sm font-semibold">{fmt(ret.totals?.closing)}</p>
          </div>
        </div>
      </Card>

      {/* Ledger */}
      <Card className="p-5">
        <PettyCashLedger returnId={ret._id} rows={ret.rows} projects={projects} canEdit={canEdit} />
      </Card>
    </div>
  );
}
