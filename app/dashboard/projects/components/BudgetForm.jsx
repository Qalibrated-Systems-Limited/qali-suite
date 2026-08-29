"use client";

import { useState, useEffect, useTransition } from "react";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Loader2, Save, Check, Pencil } from "lucide-react";
import {
  createProjectBudget,
  updateProjectBudget,
  approveProjectBudget,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";
import CostCodeCombobox from "./CostCodeCombobox";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

/**
 * A budget line names a COST CODE — 0073.
 *
 * It used to name a GL account, chosen from all 39 postable expense accounts,
 * by whoever was drafting the budget — and `PROJECT_MANAGE_ROLES` includes
 * `Manager`, so that was an operations role reading a chart of accounts. The
 * combobox even offered to CREATE an account from inside a budget line.
 *
 * No comparable system works that way: Procore and Candy budget by cost code,
 * Odoo by budgetary position, Intacct and Xero by cost category, and in every
 * one of them finance owns the mapping to the ledger. Here the mapping lives
 * on the cost code, and the database derives the account from it.
 */
const blankLine = () => ({
  _id: Date.now() + Math.floor(Math.random() * 1000),
  costCodeId: "",
  description: "",
  amount: "",
});

export default function BudgetForm({
  projectId,
  costCodes = [],
  budget,
  onCancel,
  canManageCostCodes = false,
  expenseAccounts = [],
}) {
  /**
   * A code added from inside the picker has to reach every OTHER line's picker
   * too, so the list is state here rather than the prop. revalidatePath
   * refreshes the prop on the next load; this keeps the form usable now,
   * without discarding what has been typed.
   */
  const [codes, setCodes] = useState(costCodes);
  useEffect(() => setCodes(costCodes), [costCodes]);
  const isEdit = !!budget;

  const [lines, setLines] = useState(() => {
    if (budget?.lines?.length) {
      return budget.lines.map((l, i) => ({
        _id: Date.now() + i,
        costCodeId: l.costCodeId || "",
        description: l.description || "",
        amount: l.amount ?? "",
      }));
    }
    return [blankLine()];
  });
  const [revisionNotes, setRevisionNotes] = useState(budget?.revisionNotes || "");

  const action = isEdit ? updateProjectBudget : createProjectBudget;
  const [state, formAction, isPending] = useActionState(action, {});

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message);
      if (isEdit) {
        onCancel?.();
      } else {
        // Reset form
        setLines([blankLine()]);
        setRevisionNotes("");
      }
    }
    if (state?.errors?._form) {
      toast.error(state.errors._form[0]);
    }
  }, [state]);

  const addLine = () => setLines([...lines, blankLine()]);

  const removeLine = (id) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((l) => l._id !== id));
  };

  const updateLine = (index, field, value) => {
    const updated = [...lines];
    updated[index] = { ...updated[index], [field]: value };
    setLines(updated);
  };

  const total = lines.reduce(
    (sum, line) => sum + (parseFloat(line.amount) || 0),
    0,
  );

  const handleSubmit = (formData) => {
    formData.set("projectId", projectId);
    formData.set("revisionNotes", revisionNotes);
    if (isEdit) {
      formData.set("budgetId", budget._id);
    }
    // The cost code and the amount, and nothing else. The account, its code
    // and its name are the database's to write — see 0073 decision 2.
    formData.set(
      "lines",
      JSON.stringify(
        lines
          .filter((l) => l.costCodeId && l.amount)
          .map((l) => ({
            costCodeId: l.costCodeId,
            description: l.description,
            amount: parseFloat(l.amount) || 0,
          })),
      ),
    );
    formAction(formData);
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          {isEdit ? `Edit Budget (v${budget.version})` : "Create New Budget"}
        </h2>
        {isEdit && onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <form action={handleSubmit}>
        {/* Budget Lines */}
        <div className="space-y-3 mb-4">
          <Label>Budget Lines</Label>
          {lines.map((line, index) => (
            <div
              key={line._id}
              className="rounded-lg border p-3 sm:p-0 sm:border-0 sm:rounded-none space-y-2 sm:space-y-0 sm:grid sm:grid-cols-12 sm:gap-2 sm:items-start"
            >
              <div className="sm:col-span-4">
                <Label className="text-xs text-muted-foreground sm:hidden mb-1 block">Cost code</Label>
                <CostCodeCombobox
                  value={line.costCodeId}
                  onValueChange={(id) => updateLine(index, "costCodeId", id)}
                  costCodes={codes}
                  canCreate={canManageCostCodes}
                  accounts={expenseAccounts}
                  projectId={projectId}
                  onCreated={(code) =>
                    setCodes((prev) =>
                      prev.some((c) => c._id === code._id) ? prev : [...prev, code],
                    )
                  }
                  taken={lines
                    .filter((l) => l._id !== line._id)
                    .map((l) => l.costCodeId)}
                />
              </div>
              <div className="sm:col-span-4">
                <Label className="text-xs text-muted-foreground sm:hidden mb-1 block">Description</Label>
                <Input
                  placeholder="Description..."
                  value={line.description}
                  onChange={(e) =>
                    updateLine(index, "description", e.target.value)
                  }
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex items-end gap-2 sm:contents">
                <div className="flex-1 sm:col-span-3">
                  <Label className="text-xs text-muted-foreground sm:hidden mb-1 block">Amount</Label>
                  <Input
                    type="number"
                    placeholder="Amount"
                    min="0"
                    step="1"
                    value={line.amount}
                    onChange={(e) =>
                      updateLine(index, "amount", e.target.value)
                    }
                    className="h-9 text-sm text-right"
                  />
                </div>
                <div className="sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => removeLine(line._id)}
                    disabled={lines.length <= 1}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Line
          </Button>
        </div>

        {/* Total */}
        <div className="flex justify-end mb-4 text-sm">
          <span className="text-muted-foreground mr-2">Total:</span>
          <span className="font-bold">KES {formatCurrency(total)}</span>
        </div>

        {/* Revision Notes */}
        <div className="space-y-2 mb-4">
          <Label htmlFor="revisionNotes">Revision Notes (optional)</Label>
          <Textarea
            id="revisionNotes"
            value={revisionNotes}
            onChange={(e) => setRevisionNotes(e.target.value)}
            placeholder="Why is this budget being created/revised?"
            rows={2}
          />
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isPending || lines.every((l) => !l.costCodeId)}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isEdit ? "Saving..." : "Creating..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {isEdit ? "Save Changes" : "Create Budget (Draft)"}
              </>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ============================================
// BUDGET CARD (displays a budget version with inline edit for drafts)
// ============================================
function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-700",
  superseded: "bg-gray-100 text-gray-500",
};

export function BudgetCard({
  budget,
  projectId,
  costCodes,
  canCreate,
  canApprove,
  canManageCostCodes = false,
  expenseAccounts = [],
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <BudgetForm
        projectId={projectId}
        costCodes={costCodes}
        canManageCostCodes={canManageCostCodes}
        expenseAccounts={expenseAccounts}
        budget={budget}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <h3 className="font-medium">Version {budget.version}</h3>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[budget.status]}`}>
            {budget.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-base sm:text-lg font-bold">
            KES {formatCurrency(budget.totalAmount)}
          </p>
          {budget.status === "draft" && canCreate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
          {budget.status === "draft" && canApprove && (
            <ApproveButton budgetId={budget._id} />
          )}
        </div>
      </div>

      {budget.revisionNotes && (
        <p className="text-sm text-muted-foreground mb-3">
          {budget.revisionNotes}
        </p>
      )}

      {/* Budget Lines — Mobile */}
      <div className="sm:hidden space-y-1">
        {budget.lines?.map((line, i) => (
          <div key={i} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
            <div className="min-w-0">
              <p className="text-sm truncate">
                {line.costCode ? `${line.costCode} — ${line.costCodeName}` : line.accountName}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {line.accountCode} {line.accountName}
              </p>
              {line.description && (
                <p className="text-xs text-muted-foreground truncate">{line.description}</p>
              )}
            </div>
            <p className="text-sm font-medium shrink-0">
              {formatCurrency(line.amount)}
            </p>
          </div>
        ))}
      </div>

      {/* Budget Lines — Desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 font-medium text-muted-foreground">Cost code</th>
              <th className="pb-2 font-medium text-muted-foreground">Description</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {budget.lines?.map((line, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2">
                  <span className="font-mono text-xs mr-1">{line.costCode}</span>
                  {line.costCodeName}
                  {/* What it charges, because the person reading an approved
                      budget is often the accountant, not the PM. */}
                  <span className="block text-xs text-muted-foreground">
                    {line.accountCode} {line.accountName}
                  </span>
                </td>
                <td className="py-2 text-muted-foreground">
                  {line.description || "—"}
                </td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Metadata */}
      <div className="mt-3 pt-3 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground">
        <span>
          Created by {budget.createdBy?.name} on {formatDate(budget.createdAt)}
        </span>
        {budget.approvedBy?.name && (
          <span>
            Approved by {budget.approvedBy.name} on {formatDate(budget.approvedAt)}
          </span>
        )}
      </div>
    </Card>
  );
}

// ============================================
// APPROVE BUTTON (exported for use in budget page)
// ============================================
export function ApproveButton({ budgetId }) {
  const [isPending, startTransition] = useTransition();

  const handleApprove = () => {
    startTransition(async () => {
      const result = await approveProjectBudget(budgetId);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Button
      size="sm"
      variant="default"
      onClick={handleApprove}
      disabled={isPending}
      className="bg-emerald-600 hover:bg-emerald-700 text-white"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      ) : (
        <Check className="h-3 w-3 mr-1" />
      )}
      Approve
    </Button>
  );
}
