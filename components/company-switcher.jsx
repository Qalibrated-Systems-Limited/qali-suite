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
 * Renders nothing when there is only one company to be in, because then there
 * is no choice to present.
 */
export function CompanySwitcherMenu({ companies = [], activeCompanyId, className }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState(activeCompanyId ?? null);

  const usable = companies.filter((c) => c.isActive);
  if (usable.length <= 1) return null;

  const active = usable.find((c) => c.id === activeId) ?? null;

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
