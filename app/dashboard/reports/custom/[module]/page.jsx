import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { canReportOn, reportModule, reportModulesFor } from "@/lib/reports/catalog";
import { listSavedReports } from "@/app/db/actions/report-builder-actions";
import ReportBuilder from "../ReportBuilder";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { module } = await params;
  return { title: `${reportModule(module)?.label ?? "Module"} reports` };
}

export default async function ModuleReportsPage({ params, searchParams }) {
  const { module } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const m = reportModule(module);
  if (!m) notFound();
  if (!canReportOn(session.user.role, module)) redirect("/dashboard/reports/custom");
  const saved = await listSavedReports(module);
  const others = reportModulesFor(session.user.role);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/dashboard/reports/custom" className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground print:hidden">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
              <SlidersHorizontal className="h-6 w-6 text-primary print:hidden" /> {m.label} reports
            </h1>
            <p className="text-sm text-muted-foreground print:hidden">Every activity in {m.label.toLowerCase()}, your way.</p>
          </div>
        </div>
        <nav className="flex max-w-full gap-1 overflow-x-auto print:hidden [scrollbar-width:none]">
          {others.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/reports/custom/${o.id}`}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${
                o.id === m.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.label}
            </Link>
          ))}
        </nav>
      </div>
      <ReportBuilder module={m} saved={saved} initialSavedId={sp?.saved || ""} />
    </div>
  );
}
