import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { getProjectSetupState } from "@/app/db/actions/project-actions";

/**
 * What this project still needs, and where to do it.
 *
 * A new project needs a type, contract terms, cost codes, a budget and a priced
 * bill before anything can be certified against it. Nothing said so: you opened
 * six screens and inferred it from which ones were empty, which is the single
 * loudest complaint about running a job in this module.
 *
 * IT DISAPPEARS WHEN IT IS DONE. A checklist that stays on the page forever
 * becomes furniture, and furniture is not read. Once the essential steps are
 * complete this renders nothing at all.
 *
 * THE STEPS ARE ORDERED BY DEPENDENCY, not by importance — cost codes before a
 * budget because a budget is built from them, a bill before a certificate
 * because a certificate values against it. The first outstanding step is the
 * one offered, so there is one obvious next action rather than five competing
 * ones.
 *
 * NOTHING HERE IS A GATE. Every step remains reachable in any order; this is a
 * map, not a wizard. A job that never holds retention needs no contract terms
 * and a lump-sum one needs no bill, so a project can be run perfectly well with
 * steps outstanding — which is why the card says "still to set up" rather than
 * "required".
 */
export default async function ProjectSetup({ projectId, sections }) {
  const state = await getProjectSetupState(projectId);
  if (!state) return null;

  const steps = [
    {
      done: state.hasType,
      label: "Choose a project type",
      why: "Decides which sections this project shows.",
      href: `/dashboard/projects/${projectId}/edit`,
      cta: "Set the type",
    },
    {
      done: state.hasClient,
      label: "Name the client",
      why: "An invoice needs somebody to bill.",
      href: `/dashboard/projects/${projectId}/edit`,
      cta: "Add the client",
    },
    {
      done: state.hasCostCodes,
      label: "Have cost codes to budget with",
      why: "A budget is built from codes, not from the chart of accounts.",
      href: "/dashboard/projects/cost-codes",
      cta: "Manage cost codes",
    },
    {
      done: state.hasBudget,
      label: "Draft a budget",
      why: "What the job is expected to cost, by code.",
      href: `/dashboard/projects/${projectId}/budget`,
      cta: "Build the budget",
    },
    // The rest depend on the project's type, so they are only asked for where
    // the type says the section exists at all.
    ...(sections?.certificates
      ? [
          {
            done: state.hasContract,
            label: "Enter the contract terms",
            why: "Retention, the advance and its recovery — a certificate is computed from these.",
            href: `/dashboard/projects/ipc?project=${projectId}`,
            cta: "Enter the terms",
          },
        ]
      : []),
    ...(sections?.boq
      ? [
          {
            done: state.hasAwardedBoq,
            label: "Price and award a bill of quantities",
            why: "Makes progress a measurement rather than a typed percentage.",
            href: `/dashboard/projects/boq?project=${projectId}`,
            cta: state.hasBoq ? "Finish the bill" : "Start the bill",
          },
        ]
      : []),
    ...(sections?.programme
      ? [
          {
            done: state.hasTasks,
            label: "Add or import the programme",
            why: "The activities the job is measured and reported against.",
            href: `/dashboard/projects/programme?project=${projectId}`,
            cta: "Open the programme",
          },
        ]
      : []),
  ];

  const outstanding = steps.filter((s) => !s.done);
  if (outstanding.length === 0) return null;

  const next = outstanding[0];

  return (
    <Card className="p-5 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-lg">Still to set up</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {outstanding.length} of {steps.length} steps outstanding. None of
            them blocks the others — do them in whatever order suits the job.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href={next.href}>
            {next.cta}
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </div>

      <ul className="space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2.5">
            {s.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <Link
                href={s.href}
                className={`text-sm ${
                  s.done
                    ? "text-muted-foreground line-through decoration-muted-foreground/40"
                    : "font-medium hover:underline"
                }`}
              >
                {s.label}
              </Link>
              {!s.done && (
                <p className="text-xs text-muted-foreground">{s.why}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
