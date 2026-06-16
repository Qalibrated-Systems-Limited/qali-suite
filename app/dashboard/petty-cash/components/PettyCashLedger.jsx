"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectPicker from "@/components/project-picker";
import { Plus, X, Loader2, Banknote } from "lucide-react";
import {
  addPettyCashEntry,
  removePettyCashEntry,
  fundPettyCash,
} from "@/app/mongodb/actions/petty-cash-actions";
import { toast } from "sonner";

const fmt = (n) =>
  n || n === 0 ? Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-";

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  payeeName: "",
  description: "",
  projectId: "",
  purpose: "",
  expenseAccountId: "",
  amount: "",
};

// The petty cash account ledger: DR / CR / Project-or-Purpose / running balance.
// Custodian funds the tin (posts DR Petty Cash / CR Bank) and records spends
// (posted DR Expense / CR Petty Cash on MD approval) — draft only.
export default function PettyCashLedger({
  returnId,
  rows = [],
  projects = [],
  sourceAccounts = [],
  expenseAccounts = [],
  canEdit,
}) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(emptyForm);
  const [fund, setFund] = useState({ sourceAccountId: sourceAccounts[0]?._id || "", amount: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function handleFund() {
    if (!fund.sourceAccountId) return toast.error("Select the source bank");
    if (!fund.amount || Number(fund.amount) <= 0) return toast.error("Enter an amount");
    startTransition(async () => {
      const res = await fundPettyCash(returnId, {
        sourceAccountId: fund.sourceAccountId,
        amount: Number(fund.amount),
      });
      if (res.success) {
        toast.success("Float added — transfer posted");
        setFund((f) => ({ ...f, amount: "" }));
      } else {
        toast.error(res.error || "Failed to add float");
      }
    });
  }

  function handleAdd() {
    if (!form.payeeName.trim()) return toast.error("Name is required");
    if (!form.description.trim()) return toast.error("Description is required");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter an amount");
    if (!form.projectId && !form.purpose.trim()) {
      return toast.error("Tie the expense to a project or give a clear purpose");
    }
    startTransition(async () => {
      const res = await addPettyCashEntry(returnId, { ...form, amount: Number(form.amount) });
      if (res.success) {
        toast.success("Entry added");
        setForm({ ...emptyForm, date: form.date });
      } else {
        toast.error(res.error || "Failed to add entry");
      }
    });
  }

  function handleRemove(entryId) {
    startTransition(async () => {
      const res = await removePettyCashEntry(entryId);
      if (!res.success) toast.error(res.error || "Failed to remove");
    });
  }

  return (
    <div className="space-y-4">
      {/* Fund control */}
      {canEdit && (
        <div className="rounded-lg border bg-muted/30 p-3 flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Banknote className="h-4 w-4" /> Fund the tin
          </div>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={fund.sourceAccountId}
            onChange={(e) => setFund((f) => ({ ...f, sourceAccountId: e.target.value }))}
          >
            <option value="">Source bank…</option>
            {sourceAccounts.map((a) => (
              <option key={a._id} value={a._id}>{a.accountName}</option>
            ))}
          </select>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount"
            className="w-32"
            value={fund.amount}
            onChange={(e) => setFund((f) => ({ ...f, amount: e.target.value }))}
          />
          <Button size="sm" variant="outline" onClick={handleFund} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add float"}
          </Button>
          <span className="text-xs text-muted-foreground sm:ml-2">
            Posts DR Petty Cash / CR Bank
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-2 pr-2 font-medium">Date</th>
              <th className="py-2 pr-2 font-medium">Name</th>
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 font-medium">Project / Purpose</th>
              <th className="py-2 pr-2 font-medium text-right">DR</th>
              <th className="py-2 pr-2 font-medium text-right">CR</th>
              <th className="py-2 pr-2 font-medium text-right">Balance</th>
              {canEdit && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-b last:border-0">
                <td className="py-2 pr-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="py-2 pr-2">{r.payee?.name}</td>
                <td className="py-2 pr-2">{r.description}</td>
                <td className="py-2 pr-2 text-muted-foreground">{r.projectLabel || "—"}</td>
                <td className="py-2 pr-2 text-right text-emerald-700">
                  {r.direction === "debit" ? fmt(r.amount) : "—"}
                </td>
                <td className="py-2 pr-2 text-right text-red-600">
                  {r.direction === "credit" ? fmt(r.amount) : "—"}
                </td>
                <td className="py-2 pr-2 text-right font-medium">{fmt(r.balance)}</td>
                {canEdit && (
                  <td className="py-2">
                    {/* Funding rows are posted transfers — only spends are editable here */}
                    {r.direction === "credit" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleRemove(r._id)}
                        disabled={isPending}
                        aria-label="Remove entry"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="py-6 text-center text-muted-foreground">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add-spend row (custodian, draft only) */}
      {canEdit && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            <Input placeholder="Name" value={form.payeeName} onChange={(e) => set("payeeName", e.target.value)} />
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="lg:col-span-2"
            />
            <ProjectPicker
              value={form.projectId}
              onValueChange={(v) => set("projectId", v)}
              projects={projects}
              placeholder="Project (optional)"
              className="h-9"
            />
            <Input
              placeholder="…or purpose (if no project)"
              value={form.purpose}
              onChange={(e) => set("purpose", e.target.value)}
              disabled={!!form.projectId}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={form.expenseAccountId}
              onChange={(e) => set("expenseAccountId", e.target.value)}
            >
              <option value="">Expense category (default)</option>
              {expenseAccounts.map((a) => (
                <option key={a._id} value={a._id}>{a.accountName}</option>
              ))}
            </select>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAdd} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Add spend
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
