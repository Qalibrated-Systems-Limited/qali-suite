import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Check, Lock, ArrowRight } from "lucide-react";
import { getProjectSetupState } from "@/app/db/actions/project-actions";
import { computeLifecycle, phaseHref } from "../lib/phases";

/**
 * The lifecycle stepper — the project's five phases (Set up → Budget → Deliver
 * → Certify → Close), run in order, each gated on the one before it. Reads the
 * same rule the sub-nav locks tabs with (lib/phases.js), so the step shown as
 * "now" is exactly the one whose tabs are unlocked.
 *
 * A step is a link only when it is unlocked; a locked step shows a padlock and
 * cannot be opened, which is what "you cannot move to the next step until the
 * current one is done" looks like on screen.
 */
export default async function ProjectLifecycle({ projectId, project, sections }) {
  const setup = await getProjectSetupState(projectId);
  if (!setup) return null;

  const lc = computeLifecycle({
    ...setup,
    status: project?.status,
    progressPercent: project?.progressPercent,
    showsBoq: sections?.boq,
  });
  const steps = lc.steps;
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => s.current);

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Project lifecycle</h2>
          <p className="text-sm text-muted-foreground">
            {doneCount === steps.length
              ? "Every step is done."
              : current
                ? `Step ${current.num} of ${steps.length}: ${current.label}`
                : `${doneCount} of ${steps.length} steps done`}
          </p>
        </div>
        {current && (
          <Link
            href={phaseHref(current.key, projectId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <ol className="flex items-start gap-1 overflow-x-auto">
        {steps.map((s, i) => {
          const circle = s.done
            ? "border-emerald-600 bg-emerald-600 text-white"
            : s.current
              ? "border-primary text-primary ring-4 ring-primary/15"
              : s.unlocked
                ? "border-border text-foreground"
                : "border-border/60 text-muted-foreground/40";
          const body = (
            <div className="flex min-w-[88px] flex-1 flex-col items-center text-center">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold ${circle}`}
              >
                {s.done ? (
                  <Check className="h-4 w-4" />
                ) : !s.unlocked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  s.num
                )}
              </span>
              <span
                className={`mt-1.5 text-xs font-medium ${
                  s.current
                    ? "text-primary"
                    : s.unlocked
                      ? "text-foreground"
                      : "text-muted-foreground/50"
                }`}
              >
                {s.label}
              </span>
            </div>
          );
          return (
            <li key={s.key} className="flex flex-1 items-center">
              {s.unlocked && !s.done ? (
                <Link
                  href={phaseHref(s.key, projectId)}
                  className="flex-1 rounded-lg transition-colors hover:bg-accent/50"
                >
                  {body}
                </Link>
              ) : s.unlocked ? (
                <Link href={phaseHref(s.key, projectId)} className="flex-1">
                  {body}
                </Link>
              ) : (
                <div
                  className="flex-1 cursor-not-allowed"
                  title={`Locked — finish ${steps[i - 1]?.label ?? "the previous step"} first`}
                >
                  {body}
                </div>
              )}
              {i < steps.length - 1 && (
                <span
                  className={`mx-1 mt-4 h-0.5 w-6 shrink-0 self-start sm:w-10 ${
                    steps[i].done ? "bg-emerald-600" : "bg-border"
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {current && (
        <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{current.label}:</span>{" "}
          {current.blurb}
        </p>
      )}
    </Card>
  );
}
