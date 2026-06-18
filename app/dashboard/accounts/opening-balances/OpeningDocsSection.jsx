"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

// Shared UI for opening Receivables (customer invoices) and Payables (supplier
// bills). Both are header + single-amount documents that post against Opening
// Balance Equity. Parameterised by `mode`.
export function OpeningDocsSection({
  mode, // "receivable" | "payable"
  parties, // [{ _id, name }]
  docs, // normalised [{ id, number, date, dueDate, amount, partyName, paymentStatus }]
  total,
  conversionDate, // ISO string or null
  locked, // live-locked (real transactions exist)
  onCreate, // async ({ partyId, date, dueDate, amount }) => { success, error }
  onReverse, // async (id) => { success, error }
}) {
  const isAR = mode === "receivable";
  const partyLabel = isAR ? "Customer" : "Supplier";
  const title = isAR ? "Outstanding customer invoices (AR)" : "Outstanding supplier bills (AP)";
  const hint = isAR
    ? "Each unpaid customer invoice as of your conversion date. Posts Dr Accounts Receivable / Cr Opening Balance Equity — no revenue or VAT."
    : "Each unpaid supplier bill as of your conversion date. Posts Dr Opening Balance Equity / Cr Accounts Payable — no expense, inventory or VAT.";

  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState(conversionDate ? conversionDate.slice(0, 10) : "");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [isPending, startTransition] = useTransition();

  const canAdd = !locked && !!conversionDate;

  const submit = () => {
    if (!partyId) return toast.error(`Choose a ${partyLabel.toLowerCase()}.`);
    if (!date) return toast.error("Enter the document date.");
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Enter an amount greater than zero.");
    if (conversionDate && date > conversionDate.slice(0, 10)) {
      return toast.error("Document date must be on or before the conversion date.");
    }

    startTransition(async () => {
      const res = await onCreate({ partyId, date, dueDate: dueDate || date, amount: value });
      if (res?.success) {
        toast.success(`Opening ${isAR ? "invoice" : "bill"} added (${res.invoiceNumber || res.billNumber}).`);
        setPartyId("");
        setDueDate("");
        setAmount("");
      } else {
        toast.error(res?.error || "Failed to add opening document.");
      }
    });
  };

  const reverse = (id) => {
    startTransition(async () => {
      const res = await onReverse(id);
      if (res?.success) toast.success("Reversed.");
      else toast.error(res?.error || "Failed to reverse.");
    });
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>

      {/* Existing docs */}
      {docs.length > 0 ? (
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm truncate">{d.partyName}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {d.number} · {d.date ? d.date.slice(0, 10) : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(d.amount)}</span>
                {!locked && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Reverse"
                    disabled={isPending}
                    onClick={() => reverse(d.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">No opening {isAR ? "invoices" : "bills"} yet.</p>
      )}

      {/* Add row */}
      {canAdd && (
        <div className="border-t border-border bg-muted/10 p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">{partyLabel}</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={`Select ${partyLabel.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              max={conversionDate ? conversionDate.slice(0, 10) : undefined}
              onChange={(e) => setDate(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-9 text-right tabular-nums"
            />
          </div>
          <div className="sm:col-span-5 flex justify-end">
            <Button onClick={submit} disabled={isPending} size="sm">
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Add opening {isAR ? "invoice" : "bill"}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Total */}
      <div className="border-t border-border bg-muted/20 px-4 py-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">
          {isAR ? "Total receivables" : "Total payables"}
        </span>
        <span className="text-base font-bold tabular-nums">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
