import { getProjectBudgetVsActual } from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Cost lines | Projects" };

const kes = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );

/**
 * Cost lines — every budget line with what approved requisitions and bills have
 * committed and what has actually been spent, by category. Reads the same
 * budget-vs-actual the project overview's Budget Control uses.
 */
export default async function CostLinesPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { detail: true });
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;
  const data = project ? await getProjectBudgetVsActual(project.id) : null;

  const totals = (data?.lines ?? []).reduce(
    (a, l) => ({
      budget: a.budget + (l.budgeted || 0),
      committed: a.committed + (l.committed || 0),
      spent: a.spent + (l.actual || 0),
      left: a.left + (l.available || 0),
    }),
    { budget: 0, committed: 0, spent: 0, left: 0 },
  );

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Cost lines"
        description="What has been committed and spent against each budget line, by category."
        project={project}
        projects={projects}
      />

      {!project && (
        <NoProjectsCard
          notFound={ctx.notFound}
          unselected={ctx.unselected}
          requestedId={sp?.project}
        />
      )}

      {project && !data && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          This project has no approved budget yet, so there are no cost lines to
          report against.
        </Card>
      )}

      {project && data && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Budget line</th>
                <th className="p-3 font-medium">Category</th>
                <th className="p-3 text-right font-medium">Budget</th>
                <th className="p-3 text-right font-medium">Committed</th>
                <th className="p-3 text-right font-medium">Spent</th>
                <th className="p-3 text-right font-medium">Left</th>
                <th className="p-3 text-right font-medium">Used</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.accountId || l.costCode} className="border-b last:border-0">
                  <td className="p-3">
                    {l.costCode ? (
                      <>
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{l.costCode}</span>
                        {l.costCodeName || l.description || l.accountName}
                      </>
                    ) : (
                      l.accountName
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{l.category || "—"}</td>
                  <td className="p-3 text-right">{kes(l.budgeted)}</td>
                  <td className="p-3 text-right">{l.committed ? kes(l.committed) : "—"}</td>
                  <td className="p-3 text-right">{l.actual ? kes(l.actual) : "—"}</td>
                  <td className={`p-3 text-right ${l.available < 0 ? "font-medium text-red-600" : ""}`}>
                    {kes(l.available)}
                  </td>
                  <td className="p-3 text-right">{l.percentUsed}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="p-3">Total</td>
                <td className="p-3" />
                <td className="p-3 text-right">{kes(totals.budget)}</td>
                <td className="p-3 text-right">{kes(totals.committed)}</td>
                <td className="p-3 text-right">{kes(totals.spent)}</td>
                <td className="p-3 text-right">{kes(totals.left)}</td>
                <td className="p-3" />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}
