import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { canSeeProjectsNav } from "@/lib/permissions";
import { searchProjects } from "@/app/db/actions/project-actions";

export const metadata = { title: "Completed work | Projects" };

const kes = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );

export default async function ArchivePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeProjectsNav(session.user.role)) redirect("/dashboard");

  const closed = await searchProjects("", 1, { status: "closed" });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Completed work</h1>
        <p className="text-sm text-muted-foreground">
          Projects that have been closed out — their final figures and record.
        </p>
      </div>

      {closed.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No projects have been closed yet.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Ref</th>
                <th className="p-3 font-medium">Project</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 text-right font-medium">Contract</th>
                <th className="p-3 text-right font-medium">Budget</th>
                <th className="p-3 text-right font-medium">Progress</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {closed.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3 font-mono text-xs text-muted-foreground">{p.projectNumber}</td>
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-muted-foreground">{p.client?.name || "—"}</td>
                  <td className="p-3 text-right">{p.contractValue ? kes(p.contractValue) : "—"}</td>
                  <td className="p-3 text-right">{p.budget?.amount ? kes(p.budget.amount) : "—"}</td>
                  <td className="p-3 text-right">{p.progressPercent ?? 0}%</td>
                  <td className="p-3 text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/projects/${p.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
