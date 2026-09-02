"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown, Check, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useActionState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCostCode } from "@/app/db/actions/project-actions";
import ExpenseAccountCombobox from "@/components/expense-account-combobox";

/**
 * The budget line's picker — 0073.
 *
 * THE CREATE AFFORDANCE IS GATED, NOT ABSENT — and the difference matters.
 *
 * 0073 removed it outright: a project manager could add a chart-of-accounts
 * entry from inside a budget line, which is the opposite of the reason cost
 * codes sit in front of the ledger at all. That reasoning is about WHO may
 * define a code, and it still holds — `canCreate` is the same
 * FINANCE_WRITE_ROLES check the cost codes page uses, so a Manager sees no
 * button and is still told where codes come from.
 *
 * But it is not about WHERE. An accountant part-way through a budget who needs
 * one more code had to abandon the form — losing every line typed so far —
 * walk to Projects → Cost codes, add it, and start the budget again. That cost
 * bought no governance, because they were already allowed to add it.
 *
 * The account each code charges is shown beneath it — not to be chosen, but
 * because the person approving the budget is usually the accountant, and they
 * are the one who needs to see it.
 */
export default function CostCodeCombobox({
  value,
  onValueChange,
  costCodes = [],
  taken = [],
  /** FINANCE_WRITE_ROLES. False for a project manager, who sees no button. */
  canCreate = false,
  /** Postable expense accounts — only needed when canCreate. */
  accounts = [],
  /** Scopes a new code to this project; blank makes it company-wide. */
  projectId = null,
  /** Lifts the new code into the parent's list so every line can pick it. */
  onCreated,
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const selected = value ? costCodes.find((c) => c._id === value) : null;
  const takenSet = new Set(taken.filter(Boolean));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between font-normal text-sm"
        >
          {selected ? (
            <span className="truncate">
              <span className="font-mono text-xs mr-1">{selected.code}</span>
              {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Select cost code...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search cost codes..." />
          <CommandList>
            <CommandEmpty>
              {canCreate
                ? "No match. Add it below."
                : "No cost codes. Finance adds them under Projects → Cost codes."}
            </CommandEmpty>
            <CommandGroup>
              {costCodes.map((code) => {
                // Already on another line. Two lines against one code are two
                // halves of one number, and the database refuses the second.
                const used = takenSet.has(code._id);
                return (
                  <CommandItem
                    key={code._id}
                    value={`${code.code} ${code.name} ${code.accountCode ?? ""}`}
                    disabled={used}
                    onSelect={() => {
                      if (used) return;
                      onValueChange(code._id);
                      setOpen(false);
                    }}
                    className={cn(used && "opacity-40")}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === code._id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">
                        <span className="font-mono text-xs mr-1">{code.code}</span>
                        {code.name}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {code.accountCode} {code.accountName}
                        {used && " — already on this budget"}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {canCreate && (
              <CommandGroup className="border-t">
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    setOpen(false);
                    setCreating(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4 shrink-0" />
                  New cost code
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>

      {canCreate && (
        <NewCostCodeDialog
          open={creating}
          onOpenChange={setCreating}
          accounts={accounts}
          projectId={projectId}
          onCreated={(code) => {
            onCreated?.(code);
            // Select it on the line that needed it — the whole point of not
            // making them leave the form.
            onValueChange(code._id);
            setCreating(false);
          }}
        />
      )}
    </Popover>
  );
}

/**
 * The same four fields the cost codes page asks for, in a dialog.
 *
 * It calls the SAME `createCostCode` action, so the role gate, the validation
 * and the unique-code constraint are the page's, not a second copy that can
 * drift. A code added here shows up there, and vice versa.
 */
function NewCostCodeDialog({ open, onOpenChange, accounts, projectId, onCreated }) {
  const [state, formAction, isPending] = useActionState(createCostCode, null);
  const [accountId, setAccountId] = useState("");
  const [accountList, setAccountList] = useState(accounts);
  useEffect(() => setAccountList(accounts), [accounts]);

  /**
   * AN ACTION SUCCEEDING IS AN EVENT, NOT A DERIVED VALUE — fire it once per
   * created code.
   *
   * This looped. `onCreated` is an inline arrow from the parent, so it gets a
   * fresh identity on every render, and it is in this effect's deps. The
   * handler selects the new code on the line, which calls `updateLine`, which
   * builds `[...lines]` unconditionally — so it never bails, the parent always
   * re-renders, `onCreated` is new again, and the effect fires again with
   * `state.success` still true. The dialog stays mounted at `open=false`, so
   * nothing broke the cycle: "Maximum update depth exceeded".
   *
   * The ref keys on the created id, so the handler runs once however many times
   * the effect re-runs — correct regardless of how the parent declares its
   * callback, which is the property worth having.
   */
  const notifiedFor = useRef(null);
  useEffect(() => {
    const created = state?.success ? state.costCode : null;
    if (created && notifiedFor.current !== created._id) {
      notifiedFor.current = created._id;
      onCreated(created);
    }
  }, [state, onCreated]);

  const err = (field) =>
    state?.errors?.[field]?.[0] ? (
      <p className="text-xs text-red-600">{state.errors[field][0]}</p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>New cost code</DialogTitle>
            <DialogDescription>
              Added to this company&apos;s codes. The account decides where
              spend against it lands in the ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cc-code">Code</Label>
                <Input
                  id="cc-code"
                  name="code"
                  placeholder="LAB"
                  maxLength={20}
                  className="font-mono"
                  defaultValue={state?.values?.code ?? ""}
                  required
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="cc-name">Name</Label>
                <Input
                  id="cc-name"
                  name="name"
                  placeholder="Labour"
                  maxLength={100}
                  defaultValue={state?.values?.name ?? ""}
                  required
                />
              </div>
            </div>
            {err("code")}
            {err("name")}

            <div className="space-y-1.5">
              <Label>Charges which account</Label>
              {/* Searchable, not a scroll: this list is every postable expense
                  account, and picking one by eye from 39 ordered by code is
                  the slowest part of adding a code.

                  THIS DOES NOT UNDO 0073, though it looks like it might. That
                  decision removed an account-CREATING combobox from the budget
                  line because a project manager could reach it. This dialog is
                  only rendered when `canCreate` — FINANCE_WRITE_ROLES — and
                  `quickCreateExpenseAccountPg` gates on the same list on the
                  server, so a Manager can neither see it nor call it. The rule
                  was always about who, not about which control. */}
              <input type="hidden" name="accountId" value={accountId} />
              <ExpenseAccountCombobox
                value={accountId}
                onValueChange={(id) => setAccountId(id)}
                accounts={accountList}
                onAccountCreated={(account) =>
                  setAccountList((prev) =>
                    prev.some((a) => a._id === account._id)
                      ? prev
                      : [...prev, account],
                  )
                }
                placeholder="Search accounts by code or name..."
              />
              {err("accountId")}
            </div>

            {/* Company-wide by default. A code scoped to one project cannot be
                spent by another, which is rarely what somebody adding one
                mid-budget means. */}
            <input type="hidden" name="projectId" value="" />

            {state?.errors?._form && (
              <p className="text-sm text-red-600">{state.errors._form[0]}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add code
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
