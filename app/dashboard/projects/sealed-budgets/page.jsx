import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, FileEdit, CheckCircle2 } from "lucide-react";
import { canSeeProjectsNav } from "@/lib/permissions";
import { getSealedBudgets } from "@/app/db/actions/project-actions";

export const metadata = { title: "Sealed budgets | Projects" };

const kes = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

function Meter({ pct }) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
      <span
        className={`block h-full rounded-full ${p >= 100 ? "bg-red-500" : p >= 70 ? "bg-amber-500" : "bg-emerald-600"}`}
        style={{ width: `${p}%` }}
      />
    </span>
  );
}

export default async function SealedBudgetsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeProjectsNav(session.user.role)) redirect("/dashboard");

  const budgets = await getSealedBudgets();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/projects">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Sealed budgets</h1>
          <p className="text-sm text-muted-foreground">
            The projects cleared to start on site — each with its approved budget
            and what has been committed and spent against it.
          </p>
        </div>
      </div>

      {budgets.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No budget has been approved yet.
        </Card>
      ) : (
        budgets.map((b) => (
          <Card key={b.id} className="p-4 sm:p-6">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/dashboard/projects/${b.id}`}
                className="font-semibold hover:underline"
              >
                {b.projectNumber} · {b.name}
              </Link>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
                {b.status === "closed" ? "Closed" : "Approved"}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[11px]">
                Seal {b.seal}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved by {b.approvedByName || "—"} on {day(b.approvedAt)}.
              {b.clientName ? ` Client ${b.clientName}.` : ""}
              {b.contractNumber ? ` Contract ${b.contractNumber}.` : ""}
              {b.bankAccount ? ` Runs on account ${b.bankAccount}.` : ""}
            </p>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Contract less tax</p>
                <p className="text-xl font-bold">{kes(b.contractLessTax)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sealed budget</p>
                <p className="text-xl font-bold">{kes(b.total)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={`text-xl font-bold ${b.margin != null && b.margin < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {b.margin == null ? "—" : `${b.margin}%`}
                </p>
              </div>
            </div>

            {/* Lines */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Budget line</th>
                    <th className="pb-2 px-2 font-medium">Category</th>
                    <th className="pb-2 px-2 text-right font-medium">Budget</th>
                    <th className="pb-2 px-2 text-right font-medium">Committed</th>
                    <th className="pb-2 px-2 text-right font-medium">Spent</th>
                    <th className="pb-2 px-2 text-right font-medium">Left</th>
                    <th className="pb-2 pl-2 text-right font-medium">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {b.lines.map((l) => (
                    <tr key={l.accountId || l.costCode} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {l.costCode ? (
                          <>
                            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{l.costCode}</span>
                            {l.costCodeName || l.description || l.accountName}
                          </>
                        ) : (
                          l.accountName
                        )}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{l.category || "—"}</td>
                      <td className="py-2 px-2 text-right">{kes(l.budgeted)}</td>
                      <td className="py-2 px-2 text-right">{l.committed ? kes(l.committed) : "—"}</td>
                      <td className="py-2 px-2 text-right">{l.actual ? kes(l.actual) : "—"}</td>
                      <td className={`py-2 px-2 text-right ${l.available < 0 ? "font-medium text-red-600" : ""}`}>
                        {kes(l.available)}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <Meter pct={l.percentUsed} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2 text-right">{kes(b.total)}</td>
                    <td className="py-2 px-2 text-right">{kes(b.committed)}</td>
                    <td className="py-2 px-2 text-right">{kes(b.spent)}</td>
                    <td className="py-2 px-2 text-right">{kes(b.left)}</td>
                    <td className="py-2 pl-2" />
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Committed is what approved requisitions and bills have tied up but
              not yet paid; Left takes the budget minus both, so a line cannot
              look free when the money is already promised.
            </p>

            {/* Actions */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/projects/${b.id}/budget`}>
                  <Printer className="mr-1.5 h-4 w-4" /> Open the budget
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/projects/${b.id}/budget`}>
                  <FileEdit className="mr-1.5 h-4 w-4" /> Request an amendment
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/projects/${b.id}`}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Record practical completion
                </Link>
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
