"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banknote, Loader2 } from "lucide-react";
import { fundPettyCashPg } from "@/app/db/actions/petty-cash-actions";
import { toast } from "sonner";

const fmt = (n) =>
  n || n === 0 ? Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-";

// Read-only STATEMENT of the petty cash account for the period: DR = float
// top-ups, CR = expenses paid from the tin (recorded in the expense module),
// with a running balance. Nothing is typed here — the rows are derived from the
// GL — so the return always reflects the real spend. The only action is funding
// the tin (which posts DR Petty Cash / CR Bank and shows up as a top-up).
export default function PettyCashLedger({ returnId, rows = [], sourceAccounts = [], canEdit }) {
  const [isPending, startTransition] = useTransition();
  const [fund, setFund] = useState({ sourceAccountId: sourceAccounts[0]?._id || "", amount: "" });

  function handleFund() {
    if (!fund.sourceAccountId) return toast.error("Select the source bank");
    if (!fund.amount || Number(fund.amount) <= 0) return toast.error("Enter an amount");
    startTransition(async () => {
      const res = await fundPettyCashPg(returnId, {
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

  return (
    <div className="space-y-4">
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
          <span className="text-xs text-muted-foreground sm:ml-2">Posts DR Petty Cash / CR Bank</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Spend rows are the expenses paid from this petty cash account in the
        period. Record petty cash spending as an Expense (paid from this account)
        and it appears here automatically.
      </p>

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
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ref || i} className="border-b last:border-0">
                <td className="py-2 pr-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="py-2 pr-2">{r.name}</td>
                <td className="py-2 pr-2">{r.description}</td>
                <td className="py-2 pr-2 text-muted-foreground">{r.projectLabel || "—"}</td>
                <td className="py-2 pr-2 text-right text-emerald-700">
                  {r.direction === "debit" ? fmt(r.amount) : "—"}
                </td>
                <td className="py-2 pr-2 text-right text-red-600">
                  {r.direction === "credit" ? fmt(r.amount) : "—"}
                </td>
                <td className="py-2 pr-2 text-right font-medium">{fmt(r.balance)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  No activity in this period yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
