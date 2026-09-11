"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { switchCompany } from "@/app/db/actions/company-switch-actions";

/**
 * The page a multi-company user sees before they have chosen one.
 *
 * WHY THERE IS A SCREEN FOR THIS AT ALL. Every read runs under row-level
 * security scoped to exactly ONE company, so a user authorised for several has
 * no acting company until they pick — `resolveActingCompany` refuses to pick
 * for them, deliberately (app/db/tenant.ts). Until this existed, that refusal
 * arrived as a thrown Error, which app/dashboard/error.jsx rendered as "Oops!
 * Something went wrong": the one piece of information the reader needed —
 * choose a company — was the one piece the error boundary discarded.
 *
 * It bit SuperAdmins hardest, because platform staff hold a grant to every
 * tenant and so are never down to one. It was never only theirs: an Admin of
 * two companies hit exactly the same wall.
 *
 * Routes that genuinely operate on no company — the platform dashboard and
 * Admin → Companies — are exempted by the layout, not by this component.
 */
export function ChooseCompany({ companies = [] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [choosing, setChoosing] = useState(null);

  function enter(company) {
    if (isPending) return;
    setChoosing(company.id);
    startTransition(async () => {
      const result = await switchCompany(company.id);
      if (!result?.ok) {
        toast.error(result?.error ?? "Could not open that company.");
        setChoosing(null);
        return;
      }
      toast.success(`Now operating as ${result.name}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 py-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Choose a company
        </h1>
        <p className="text-sm text-muted-foreground">
          You have access to {companies.length}. Every page shows one company&apos;s
          records at a time — pick the one you want to work in. You can switch
          again from the menu at the top.
        </p>
      </header>

      <div className="space-y-2">
        {companies.map((company) => (
          <Card
            key={company.id}
            role="button"
            tabIndex={0}
            onClick={() => enter(company)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                enter(company);
              }
            }}
            className="cursor-pointer transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{company.name}</p>
                {company.role && (
                  <p className="truncate text-xs text-muted-foreground">
                    {company.role}
                  </p>
                )}
              </div>
              {choosing === company.id && isPending ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
