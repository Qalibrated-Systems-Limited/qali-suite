import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { canSeeFinanceNav } from "@/lib/permissions";
import {
  getPettyCashReturnByIdPg,
  getPettyCashFloatAccountsPg,
} from "@/app/db/actions/petty-cash-actions";
import {
  PETTY_CASH_CUSTODIAN_ROLES,
  PETTY_CASH_APPROVER_ROLES,
} from "@/lib/utils/role-gates";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import PettyCashLedger from "../components/PettyCashLedger";
import PettyCashWorkflow from "../components/PettyCashWorkflow";

// From lib/utils/role-gates.js rather than redefined here — this page and the
// actions must agree about who may submit, and two copies of a role list is
// how they stop agreeing.

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

  const ret = await getPettyCashReturnByIdPg(id);
  if (!ret) notFound();

  const floatAccounts = await getPettyCashFloatAccountsPg();
  // Source accounts for funding = cash/bank accounts other than this float.
  const sourceAccounts = floatAccounts.filter((a) => a.id !== ret.floatAccountId);
  const { getCompanyForDocuments } = await import("@/app/db/platform");
  const company = await getCompanyForDocuments(String(ret.companyId));

  const role = session.user.role;
  // A REJECTED return is editable too — that is the whole point of sending it
  // back. The Mongo reject set the status to "draft", so this only ever had a
  // draft to test for.
  const canEdit =
    PETTY_CASH_CUSTODIAN_ROLES.includes(role) &&
    ["draft", "rejected"].includes(ret.status);
  const canApprove =
    PETTY_CASH_APPROVER_ROLES.includes(role) && ret.status === "submitted";

  /**
   * The figures on the page.
   *
   * A signed return shows what was SIGNED. The Mongo query returned the live
   * recomputation under the frozen figure's key, so an approved return
   * displayed numbers nobody had approved — book an expense afterwards, dated
   * inside the period, and the signed document quietly changed.
   */
  const figures = ret.frozen
    ? {
        opening: ret.frozen.openingBalance,
        debits: ret.frozen.debits,
        credits: ret.frozen.credits,
        closing: ret.frozen.closing,
        glClosing: ret.frozen.glClosing,
        variance: ret.frozen.variance,
      }
    : { opening: ret.live.openingBalance, ...ret.live.totals };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
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
            <p className="text-sm font-semibold">{fmt(figures.opening)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Float in (DR)</p>
            <p className="text-sm font-semibold text-emerald-700">{fmt(figures.debits)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Spent (CR)</p>
            <p className="text-sm font-semibold text-red-600">{fmt(figures.credits)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Closing balance</p>
            <p className="text-sm font-semibold">{fmt(figures.closing)}</p>
          </div>
        </div>

        {/* Reconciliation: the float's GL balance vs what top-ups/receipts
            account for. Non-zero = cash moved by some route the return doesn't
            capture (transfer, refund, manual entry) — i.e. over/short. */}
        {Math.abs(figures.variance || 0) > 0.01 ? (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <span className="font-semibold">
              {figures.variance > 0 ? "Over" : "Short"} by{" "}
              {fmt(Math.abs(figures.variance))}
            </span>{" "}
            — the float&apos;s ledger balance ({fmt(figures.glClosing)})
            doesn&apos;t match what these top-ups and receipts account for (
            {fmt(figures.closing)}). Check for transfers, refunds or manual
            entries on this account.
          </div>
        ) : null}

        {/* NEW. The ledger has moved since this was signed — something was
            booked into the period after sign-off. Previously invisible,
            because the page recomputed and displayed the new figure as
            though it were the signed one. */}
        {ret.drift != null && Math.abs(ret.drift) > 0.01 ? (
          <div className="mt-3 rounded-md border border-blue-500/40 bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-400">
            <span className="font-semibold">
              The ledger has moved {fmt(Math.abs(ret.drift))}{" "}
              {ret.drift > 0 ? "up" : "down"} since this was{" "}
              {ret.status === "approved" ? "approved" : "submitted"}
            </span>{" "}
            — the figures above are the ones signed off (
            {fmtDate(ret.frozen?.at)}). The float&apos;s period now computes to{" "}
            {fmt(ret.live.totals.closing)}. Something was booked into this
            period afterwards.
          </div>
        ) : null}
      </Card>

      {/* Ledger */}
      <Card className="p-5">
        <PettyCashLedger
          returnId={ret._id}
          rows={ret.live.rows}
          sourceAccounts={sourceAccounts}
          canEdit={canEdit}
        />
      </Card>
    </div>
  );
}
