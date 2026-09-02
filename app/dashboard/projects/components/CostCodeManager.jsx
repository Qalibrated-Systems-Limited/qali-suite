"use client";

import { useState, useTransition, useActionState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, Pencil, Tags } from "lucide-react";
import {
  createCostCode,
  updateCostCode,
  toggleCostCodeActive,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";
import ExpenseAccountCombobox from "@/components/expense-account-combobox";

/**
 * Cost codes — the vocabulary a project budget is built from (0073).
 *
 * The account each code charges is the point of this page. Everywhere else in
 * the projects module, cost codes are picked and accounts are invisible; here
 * is where finance decides which is which, once.
 *
 * SEVERAL CODES MAY CHARGE ONE ACCOUNT — "Labour, site" and "Labour, office"
 * both on 6200 Wages is normal. What they cannot do is both appear on one
 * budget, because budget-versus-actual matches by account and two lines on one
 * account each show its full spend. The form says so rather than letting the
 * budget page be the first place anyone finds out.
 */
export default function CostCodeManager({
  costCodes = [],
  accounts = [],
  projects = [],
  canManage = false,
}) {
  const [editing, setEditing] = useState(null); // null | "new" | id
  const [isPending, startTransition] = useTransition();

  const byAccount = costCodes.reduce((acc, c) => {
    acc[c.accountId] = (acc[c.accountId] ?? 0) + 1;
    return acc;
  }, {});

  function handleToggle(code) {
    startTransition(async () => {
      const res = await toggleCostCodeActive(code._id);
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {canManage && editing !== "new" && (
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4 mr-1" />
          New cost code
        </Button>
      )}

      {editing === "new" && (
        <CostCodeForm
          accounts={accounts}
          projects={projects}
          onDone={() => setEditing(null)}
        />
      )}

      {costCodes.length === 0 && editing !== "new" && (
        <Card className="p-6 text-sm text-muted-foreground">
          No cost codes yet. A project budget is built from these, so it needs at
          least one before a budget can be drafted — start with the categories
          the business actually spends in: labour, materials, plant, subcontract.
        </Card>
      )}

      <div className="space-y-2">
        {costCodes.map((code) =>
          editing === code._id ? (
            <CostCodeForm
              key={code._id}
              costCode={code}
              accounts={accounts}
              projects={projects}
              onDone={() => setEditing(null)}
            />
          ) : (
            <Card key={code._id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tags className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-mono text-sm">{code.code}</span>
                    <span className="text-sm">{code.name}</span>
                    {!code.isActive && (
                      <Badge variant="secondary" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                    {code.projectId && (
                      <Badge variant="outline" className="text-xs">
                        One project only
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Charges{" "}
                    <span className="font-mono">{code.accountCode}</span>{" "}
                    {code.accountName}
                    {byAccount[code.accountId] > 1 && (
                      <span className="text-amber-600">
                        {" "}
                        — shared with {byAccount[code.accountId] - 1} other code
                        {byAccount[code.accountId] > 2 ? "s" : ""}, so only one
                        of them can be on a budget
                      </span>
                    )}
                  </p>
                  {code.description && (
                    <p className="text-xs text-muted-foreground">
                      {code.description}
                    </p>
                  )}
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => setEditing(code._id)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleToggle(code)}
                    >
                      {code.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}

function CostCodeForm({ costCode = null, accounts, projects, onDone }) {
  const isEdit = !!costCode;
  /**
   * The combobox is controlled, so the value reaches the action through a
   * hidden input rather than as a native form field.
   *
   * `accountList` is state because the combobox can CREATE an account —
   * `quickCreateExpenseAccountPg` — and the new one has to be selectable
   * without a page load, exactly as it is on the expense form.
   */
  const [accountId, setAccountId] = useState(costCode?.accountId ?? "");
  const [accountList, setAccountList] = useState(accounts);
  useEffect(() => setAccountList(accounts), [accounts]);
  const action = isEdit ? updateCostCode.bind(null, costCode._id) : createCostCode;
  const [state, formAction, isPending] = useActionState(action, null);

  /**
   * Once per outcome. `onDone` is an inline arrow from the parent, so it is a
   * new identity every render and this effect re-runs on each — and `state`
   * stays successful, so without the guard the toast fires repeatedly and
   * `onDone` is called again each time.
   *
   * It does not loop TODAY only because `onDone` unmounts this form, which is
   * luck rather than a design — the same shape in `NewCostCodeDialog`, whose
   * dialog stays mounted, produced "Maximum update depth exceeded".
   */
  const handled = useRef(null);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.success) {
      toast.success(state.message);
      onDone?.();
    }
    if (state.errors?._form) toast.error(state.errors._form[0]);
  }, [state, onDone]);

  const err = (field) =>
    state?.errors?.[field] ? (
      <p className="text-xs text-red-500">{state.errors[field][0]}</p>
    ) : null;

  return (
    <Card className="p-4 sm:p-5">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              placeholder="LAB"
              maxLength={20}
              defaultValue={costCode?.code ?? state?.values?.code ?? ""}
              required
            />
            {err("code")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="Labour"
              maxLength={100}
              defaultValue={costCode?.name ?? state?.values?.name ?? ""}
              required
            />
            {err("name")}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Charges which account</Label>
          {/* A scroll-and-select over 39 accounts ordered by code is a search
              problem pretending to be a list. Same combobox the expense form
              uses: type to filter, grouped by sub-type, and it can create the
              account if the one wanted does not exist. */}
          <input type="hidden" name="accountId" value={accountId} />
          <ExpenseAccountCombobox
            value={accountId}
            onValueChange={(id) => setAccountId(id)}
            accounts={accountList}
            onAccountCreated={(account) =>
              setAccountList((prev) =>
                prev.some((a) => a._id === account._id) ? prev : [...prev, account],
              )
            }
            placeholder="Search accounts by code or name..."
          />
          <p className="text-xs text-muted-foreground">
            Where spend against this code lands in the ledger. Project managers
            never see this — they pick the code.
          </p>
          {err("accountId")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            name="description"
            placeholder="What belongs under this code"
            maxLength={500}
            defaultValue={costCode?.description ?? ""}
          />
          {err("description")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="projectId">Scope</Label>
          <select
            id="projectId"
            name="projectId"
            defaultValue={costCode?.projectId ?? ""}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Every project in the company</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.projectNumber} — {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Scope it to one project only when the code means nothing anywhere
            else.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isEdit ? (
              "Save"
            ) : (
              "Add cost code"
            )}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
