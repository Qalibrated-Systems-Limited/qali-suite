import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { canSeeFinanceNav } from "@/lib/permissions";
import {
  getPettyCashReturns,
  getPettyCashFloatAccounts,
} from "@/app/mongodb/queries/petty-cash-queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import NewPettyCashReturn from "./components/NewPettyCashReturn";

export const metadata = { title: "Petty Cash" };

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

export default async function PettyCashPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeFinanceNav(session.user.role)) redirect("/dashboard");

  const [returns, floats] = await Promise.all([
    getPettyCashReturns(),
    getPettyCashFloatAccounts(),
  ]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1 sm:space-y-2 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Petty Cash
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground hidden sm:block">
            Returns submitted to the MD for approval
          </p>
        </div>
        <NewPettyCashReturn floats={floats} />
      </div>

      {returns.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No petty cash returns yet. Open one to start recording.
        </Card>
      ) : (
        <Card className="divide-y">
          {returns.map((r) => (
            <Link
              key={r._id}
              href={`/dashboard/petty-cash/${r._id}`}
              className="flex items-center justify-between gap-4 p-4 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{r.documentNumber}</p>
                  <Badge className={`text-xs ${STATUS_STYLES[r.status] || ""}`}>
                    {r.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {r.floatAccountName} · {fmtDate(r.period?.from)} – {fmtDate(r.period?.to)}
                  {r.custodian?.name ? ` · ${r.custodian.name}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold">{fmt(r.totals?.credits)}</p>
                <p className="text-xs text-muted-foreground">
                  bal {fmt(r.totals?.closing)}
                </p>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
