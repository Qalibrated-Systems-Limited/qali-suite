import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  AlertTriangle,
  TrendingDown,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";
import { canSeeProjectsNav } from "@/lib/permissions";
import { getProjectFindings } from "@/app/db/actions/project-actions";

export const metadata = { title: "Findings | Projects" };

const kes = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );

/**
 * The findings register — the problems the module exists to stop, named rather
 * than hidden. Every row is computed from the sealed budgets and the live
 * project list (getProjectFindings); nothing is entered here.
 */
function Group({ icon: Icon, tone, title, blurb, children, count }) {
  const tones = {
    red: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
    amber:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  };
  return (
    <Card className="overflow-hidden p-0">
      <div className={`flex items-start gap-2.5 border-b p-4 ${tones[tone]}`}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            <span className="rounded-full bg-background/60 px-2 py-0.5 text-xs font-medium">
              {count}
            </span>
          </div>
          <p className="mt-0.5 text-xs opacity-90">{blurb}</p>
        </div>
      </div>
      <div className="divide-y">{children}</div>
    </Card>
  );
}

function Row({ project, children }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm font-medium hover:underline"
        >
          {project.name}
        </Link>
        <p className="font-mono text-xs text-muted-foreground">
          {project.projectNumber}
        </p>
      </div>
      <div className="shrink-0 text-right text-sm">{children}</div>
    </div>
  );
}

export default async function FindingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeProjectsNav(session.user.role)) redirect("/dashboard");

  const f = await getProjectFindings();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/projects">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Findings</h1>
          <p className="text-sm text-muted-foreground">
            What reading the books turned up — budgets with no margin, spend past
            the budget line, and jobs running without an approved budget. The
            problems the system exists to stop.
          </p>
        </div>
      </div>

      {f.total === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <p className="text-sm font-medium">Nothing to report.</p>
          <p className="text-sm text-muted-foreground">
            Every active job has an approved budget, and every budget shows a
            margin with nothing overspent.
          </p>
        </Card>
      ) : (
        <>
          {f.noApprovedBudget.length > 0 && (
            <Group
              icon={ShieldAlert}
              tone="red"
              title="On site with no approved budget"
              count={f.noApprovedBudget.length}
              blurb="Active jobs cleared to spend against a figure nobody approved."
            >
              {f.noApprovedBudget.map((p) => (
                <Row key={p.id} project={p}>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/projects/${p.id}/budget`}>
                      Build the budget
                    </Link>
                  </Button>
                </Row>
              ))}
            </Group>
          )}

          {f.noMargin.length > 0 && (
            <Group
              icon={TrendingDown}
              tone="red"
              title="Priced to lose"
              count={f.noMargin.length}
              blurb="The budgeted cost equals or exceeds the recoverable contract value — no margin before the job even starts."
            >
              {f.noMargin.map((p) => (
                <Row key={p.id} project={p}>
                  <span className="font-medium text-red-600">
                    {p.margin}% margin
                  </span>
                </Row>
              ))}
            </Group>
          )}

          {f.overspent.length > 0 && (
            <Group
              icon={AlertTriangle}
              tone="red"
              title="A budget line overspent"
              count={f.overspent.length}
              blurb="Committed-plus-spent has passed the budgeted figure, so the recovery the certificate assumes is already gone."
            >
              {f.overspent.map((p) => (
                <div key={p.id} className="p-3">
                  <Link
                    href={`/dashboard/projects/${p.id}/budget`}
                    className="text-sm font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {p.projectNumber}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {p.overLines.map((l, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {l.costCode ? `${l.costCode} — ` : ""}
                          {l.costCodeName || l.accountName || l.description || "Line"}
                        </span>
                        <span className="shrink-0 font-medium text-red-600">
                          {kes(l.available)} over
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Group>
          )}

          {f.thinMargin.length > 0 && (
            <Group
              icon={TrendingDown}
              tone="amber"
              title="Thin margin"
              count={f.thinMargin.length}
              blurb="Under ten per cent — a single variation or a cost overrun erodes it."
            >
              {f.thinMargin.map((p) => (
                <Row key={p.id} project={p}>
                  <span className="font-medium text-amber-600">
                    {p.margin}% margin
                  </span>
                </Row>
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}
