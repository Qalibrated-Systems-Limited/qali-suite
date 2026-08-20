"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchCompany } from "@/app/db/actions/company-switch-actions";
import { cn } from "@/lib/utils";

/**
 * Picks which company this session operates on.
 *
 * ONE AT A TIME, deliberately. A user may be authorised for several; every
 * request runs against exactly one, and row-level security is scoped to that
 * one. Showing several companies' records together would not be a wider view
 * of the books — it would be a meaningless one. Every ERP that handles this
 * well makes you choose: SAP at logon, Odoo and Dynamics in the chrome, Xero
 * by leaving one organisation to enter another.
 *
 * TAKES ITS DATA AS PROPS. The list is read on the server (CompanySwitcher in
 * company-switcher-server.jsx) rather than fetched from here, because there is
 * no <SessionProvider> in this app and nothing client-side that can be asked
 * which company is active. The choice is written by a server action for the
 * same reason: the session is a cookie the server owns.
 *
 * WITH ONE COMPANY IT STILL SAYS WHICH. It used to render nothing, on the
 * reasoning that a menu of one is not a choice — which is true, and left the
 * screen with no answer to "which tenant am I in". That question is asked most
 * by exactly the people who see one company today and several tomorrow: a
 * SuperAdmin's session carries no company of its own, so "the only one there
 * is" and "the one I switched to" look identical, and only one of them stays
 * true after a second tenant is created.
 *
 * So: a plain label at one, a menu at several. Odoo and Dynamics both keep the
 * company in the chrome whether or not you can change it, for the same reason —
 * the numbers on the page belong to a company, and the reader should not have
 * to remember which.
 */
export function CompanySwitcherMenu({ companies = [], activeCompanyId, className }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState(activeCompanyId ?? null);

  const usable = companies.filter((c) => c.isActive);
  // Nothing to say only when there is nothing to be in — a signed-out user, or
  // a tenant that has not been provisioned yet.
  if (usable.length === 0) return null;

  const active = usable.find((c) => c.id === activeId) ?? usable[0] ?? null;

  // One company is not a choice, so it is not a button. It is still the answer
  // to which company these numbers belong to.
  if (usable.length === 1) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-xs",
          "text-muted-foreground max-w-[10rem] sm:max-w-[16rem]",
          className,
        )}
        title={`Operating in ${active?.name ?? ""}`}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{active?.name}</span>
      </span>
    );
  }

  function switchTo(companyId) {
    if (companyId === activeId || isPending) return;
    startTransition(async () => {
      const result = await switchCompany(companyId);
      if (!result?.ok) {
        toast.error(result?.error ?? "Could not switch company.");
        return;
      }
      setActiveId(result.companyId);
      toast.success(`Now operating as ${result.name}`);
      // The server action revalidated every layout; this re-renders the tree
      // so the page in front of the user is the new company's, not the old
      // one's with a new name on it.
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          className={cn("gap-2 max-w-[10rem] sm:max-w-[16rem] h-8", className)}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{active?.name ?? "Select company"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Operating as
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {usable.map((company) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => switchTo(company.id)}
            className="gap-2"
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                company.id === activeId ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate">{company.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
