import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Forms Register | Projects",
  description: "The standard site forms tracked on a construction project",
};

/**
 * The standard site-administration forms used on a construction contract —
 * a reference registry, not transactional records. There is no forms
 * database yet (see ComingSoonCard elsewhere for that honesty pattern);
 * this page is deliberately different because the list itself — which
 * forms exist, what they're for, when they're due, and which are
 * time-critical — is real, useful information on its own, independent of
 * digital submission ever shipping.
 */
const FORM_DEFS = [
  { code: "AFI", name: "Availability for Inspection", when: "Before covering any work", critical: false },
  { code: "TRF", name: "Test Requisition Form", when: "24 hours before each test", critical: false },
  { code: "CPS", name: "Concrete Pouring Slip", when: "Before each concrete pour", critical: false },
  { code: "RFI", name: "Request for Information", when: "When specs are unclear", critical: false },
  { code: "CSD", name: "Contractor's Site Diary", when: "Every working day", critical: false },
  { code: "AR", name: "Accident Report", when: "Within 24 hours of any incident", critical: true },
  { code: "EI", name: "Engineer's Instruction", when: "On each instruction from the RE", critical: false },
  { code: "VO", name: "Variation Order", when: "Before any varied work starts", critical: false },
  { code: "DWR", name: "Daywork Record Sheet", when: "Daily when daywork is active", critical: false },
  { code: "NCR", name: "Non-Conformance Report", when: "On any non-conformance found", critical: false },
  { code: "MAR", name: "Material Approval Request", when: "Before each new material source", critical: false },
  { code: "DNR", name: "Defect Notification & Rectification", when: "During the defects liability period", critical: false },
  { code: "MPR", name: "Monthly Progress Report", when: "By the 5th of each month", critical: false },
  { code: "LER", name: "Labour & Equipment Return", when: "Monthly, with the MPR", critical: false },
  { code: "EOT", name: "Extension of Time Notice", when: "Within 28 days of a delay event", critical: true },
  { code: "CCN", name: "Contractor's Claim Notice", when: "Within 28 days of a cost event", critical: true },
];

export default async function FormsRegisterPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="Forms Register"
        description="The standard site-administration forms tracked on a construction contract, and when each one is due."
        project={project}
        projects={projects}
      />

      {!project && <NoProjectsCard />}

      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Standard forms</h2>
          <Badge variant="outline" className="text-xs">Reference — digital submission coming soon</Badge>
        </div>

        {/* Mobile: cards */}
        <div className="sm:hidden space-y-2">
          {FORM_DEFS.map((f) => (
            <div key={f.code} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs font-semibold text-primary">{f.code}</span>
                {f.critical && (
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]">
                    Time-critical
                  </Badge>
                )}
              </div>
              <p className="text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{f.when}</p>
            </div>
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground w-20">Code</th>
                <th className="pb-2 font-medium text-muted-foreground">Form</th>
                <th className="pb-2 font-medium text-muted-foreground">Due</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Priority</th>
              </tr>
            </thead>
            <tbody>
              {FORM_DEFS.map((f) => (
                <tr key={f.code} className="border-b last:border-0">
                  <td className="py-2.5 font-mono text-xs font-semibold text-primary">{f.code}</td>
                  <td className="py-2.5 font-medium">{f.name}</td>
                  <td className="py-2.5 text-muted-foreground">{f.when}</td>
                  <td className="py-2.5 text-right">
                    {f.critical ? (
                      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                        Time-critical
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Routine</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
