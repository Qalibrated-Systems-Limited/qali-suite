import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";

/**
 * The standard site-administration forms used on a construction contract.
 *
 * A REFERENCE PANEL, NOT A SECTION. This was its own page in the module
 * navigation — sixteen hardcoded strings, a permanently disabled "New entry"
 * button, and a badge admitting digital submission was coming soon. A page
 * that has to explain what it is not has not earned a nav slot; it is a panel
 * inside the section it belongs to. See PROJECTS-QALITRACK-PLAN.md §10.3.
 *
 * It belongs HERE because the register above it holds four of these forms —
 * EI, VO, NCR and the RFI response — so this is the list of what else the
 * contract expects, read beside the ones that exist.
 *
 * Collapsed by default, and a native `<details>` so it stays a server
 * component: the list is worth having and it is not what anyone opened the
 * page for.
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

export default function FormsReference() {
  return (
    <Card className="p-4 sm:p-5">
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <ClipboardList className="h-5 w-5 text-muted-foreground shrink-0" />
          <h3 className="font-semibold">Standard site forms</h3>
          <Badge variant="outline" className="text-xs font-normal">
            {FORM_DEFS.length} · reference
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground group-open:hidden">
            Show
          </span>
          <span className="ml-auto text-xs text-muted-foreground hidden group-open:inline">
            Hide
          </span>
        </summary>

        <p className="text-sm text-muted-foreground mt-3">
          The forms a construction contract expects, and when each is due. Three
          are time-barred — a late notice does not weaken a claim, it ends it.
        </p>

        {/* Mobile: cards */}
        <div className="sm:hidden space-y-2 mt-3">
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
        <div className="hidden sm:block overflow-x-auto mt-3">
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
      </details>
    </Card>
  );
}
