import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import { cLeads, cLeadStats } from "@/app/mongodb/queries/lead-queries";
import { Card, CardContent } from "@/components/ui/card";
import LeadCreateForm from "./components/LeadCreateForm";
import LeadRowActions from "./components/LeadRowActions";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";

export const metadata = {
  title: "Leads | ERP System",
  description: "Unqualified prospects — the top of the sales funnel",
};

// Auth-gated (session headers) — never statically prerendered.
export const dynamic = "force-dynamic";

const STATUS_STYLES = {
  new: "bg-blue-500/10 text-blue-600",
  contacted: "bg-amber-500/10 text-amber-600",
  qualified: "bg-emerald-500/10 text-emerald-600",
  unqualified: "bg-muted text-muted-foreground",
  converted: "bg-primary/10 text-primary",
};

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default async function LeadsPage() {
  // Page-level auth (defense in depth — middleware is optimistic) + the
  // same role gate the sidebar uses, so direct-URL access is refused too.
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSalesNav(session.user.role)) return <AccessDenied resource="leads" />;

  const [leads, stats] = await Promise.all([cLeads(), cLeadStats()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Prospects you haven&apos;t qualified yet. Convert one to create a
            customer and an opportunity.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat label="Total leads" value={stats.total} />
        <Stat label="Open" value={stats.open} />
        <Stat label="Open pipeline value" value={KES(stats.value)} />
        <Stat label="Converted" value={stats.byStatus?.converted?.count || 0} />
      </div>

      <LeadCreateForm />

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No leads yet. Create your first one above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Lead</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Est. value</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l._id} className="border-b border-border/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/leads/${l._id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {l.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {l.leadNumber}
                          {l.company ? ` · ${l.company}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{l.email || "—"}</div>
                        <div className="text-xs">{l.phone || ""}</div>
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {l.source?.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3">{KES(l.estimatedValue)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            STATUS_STYLES[l.status] || "bg-muted"
                          }`}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <LeadRowActions leadId={l._id} status={l.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3">
        <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-lg font-semibold sm:text-xl">{value}</div>
      </CardContent>
    </Card>
  );
}
