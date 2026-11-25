import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SlidersHorizontal, ChevronRight } from "lucide-react";
import { reportModulesFor } from "@/lib/reports/catalog";

export const metadata = { title: "Report builder" };

export default async function CustomReportsIndex() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const modules = reportModulesFor(session.user.role);
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
          <SlidersHorizontal className="h-6 w-6 text-primary" /> Report builder
        </h1>
        <p className="text-sm text-muted-foreground">
          Build your own report on any module’s activity — pick the data, the columns, filters, dates, grouping and
          totals. Save it for later, export to CSV, or print.
        </p>
      </div>
      {modules.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          Your role has no module reports. Ask your administrator.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/reports/custom/${m.id}`}
              className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{m.label}</h2>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{m.datasets.map((d) => d.label).join(" · ")}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
