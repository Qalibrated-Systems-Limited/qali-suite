import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getOrgChart } from "@/app/db/actions/hr-records-actions";
import { PageHeader, Empty } from "../components/records-ui";

export const metadata = { title: "Org chart | HR" };

/**
 * Who reports to whom, from each employee's "reports to". People with no
 * manager (or whose manager has left) are at the top. A loop in the data —
 * A reports to B reports to A — is broken rather than drawn forever.
 */
/** The tree, built before rendering so a reporting loop is cut exactly once. */
function build(person, byManager, seen) {
  seen.add(person.id);
  const children = (byManager.get(person.id) || []).filter((r) => !seen.has(r.id)).map((r) => build(r, byManager, seen));
  return { person, children };
}

function Node({ node }) {
  const { person, children } = node;
  return (
    <li className="mt-2">
      <Link href={`/dashboard/hr/employees/${person.id}`} className="inline-flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm hover:bg-muted/50">
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
          {person.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={person.photo_url} alt="" className="h-8 w-8 object-cover" />
          ) : (
            person.name.split(" ").map((p) => p[0]).slice(0, 2).join("")
          )}
        </span>
        <span>
          <span className="block text-sm font-medium">{person.name}</span>
          <span className="block text-xs text-muted-foreground">
            {person.designation || "—"}{person.department ? ` · ${person.department}` : ""}
            {children.length ? ` · ${children.length} report${children.length > 1 ? "s" : ""}` : ""}
          </span>
        </span>
      </Link>
      {children.length > 0 && (
        <ul className="ml-5 border-l border-border pl-4">
          {children.map((c) => <Node key={c.person.id} node={c} />)}
        </ul>
      )}
    </li>
  );
}

export default async function OrgChartPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "hr.view")) redirect("/dashboard/hr");
  const people = await getOrgChart();
  const ids = new Set(people.map((p) => p.id));
  const byManager = new Map();
  for (const p of people) {
    const key = p.manager_id && ids.has(p.manager_id) && p.manager_id !== p.id ? p.manager_id : "root";
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key).push(p);
  }
  const seen = new Set();
  const tree = (byManager.get("root") || []).map((r) => build(r, byManager, seen));
  // Anyone caught in a reporting loop has no root: start a branch at them.
  for (const p of people) if (!seen.has(p.id)) tree.push(build(p, byManager, seen));
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Org chart" sub="Built from each employee's “reports to”. Set it on the employee's record." />
      {people.length === 0 ? (
        <Empty>No active employees.</Empty>
      ) : (
        <ul>
          {tree.map((n) => <Node key={n.person.id} node={n} />)}
        </ul>
      )}
    </div>
  );
}
