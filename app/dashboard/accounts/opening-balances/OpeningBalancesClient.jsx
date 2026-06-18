"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info, Loader2, Lock, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/utils";
import {
  postOpeningBalances,
  setConversionDate,
  createOpeningInvoice,
  createOpeningBill,
  reverseOpeningInvoice,
  reverseOpeningBill,
} from "@/app/mongodb/actions/opening-balance-actions";
import { OpeningDocsSection } from "./OpeningDocsSection";

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const TYPE_LABEL = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

// Assets & expenses sit on the debit side; everything else on credit.
const sideOf = (accountType) =>
  ["asset", "expense"].includes(accountType) ? "debit" : "credit";

// Subledger-backed control accounts are excluded — their opening balance must
// come from the subledger, not a lump here, or you'd double-count / disagree:
//   AR  → open invoices,  AP → open bills,
//   inventory / technician_stock → per-item stock counts (inventory adjustments).
const EXCLUDED_SYSTEM = new Set([
  "accounts_receivable",
  "accounts_payable",
  "inventory",
  "technician_stock",
  // Fixed assets come from the asset register (cost + accumulated depreciation),
  // so the register and GL stay in agreement.
  "accumulated_depreciation",
  // Clearing accounts that net to zero in normal operation — an opening lump
  // here is almost always a mistake. (GRNI is kept: it can hold a real cutover
  // balance.)
  "inventory_suspense",
  "inventory_adjustments",
  // System-computed equity — the balance sheet derives current-year earnings;
  // it's never a manual opening-balance target.
  "current_year_earnings",
]);

// Fixed-asset COST accounts have no dedicated systemAccount, so exclude them by
// subType — opening values for them come from the asset register.
const EXCLUDED_SUBTYPE = new Set(["fixed_asset"]);

const amt = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : 0;
};

export function OpeningBalancesClient({ setup }) {
  const {
    conversionDate,
    liveLocked,
    customers = [],
    suppliers = [],
    openingReceivables = [],
    openingPayables = [],
    receivablesTotal = 0,
    payablesTotal = 0,
  } = setup;

  const [convDate, setConvDate] = useState(conversionDate ? conversionDate.slice(0, 10) : "");
  const [savingDate, startSaveDate] = useTransition();

  const saveConversionDate = () => {
    if (!convDate) {
      toast.error("Choose a conversion date.");
      return;
    }
    startSaveDate(async () => {
      const res = await setConversionDate({ date: convDate });
      if (res?.success) toast.success("Conversion date saved.");
      else toast.error(res?.error || "Failed to save conversion date.");
    });
  };

  // Normalise AR/AP docs into the shape OpeningDocsSection expects.
  const receivables = openingReceivables.map((d) => ({
    id: d._id,
    number: d.invoiceNumber,
    date: d.invoiceDate,
    dueDate: d.dueDate,
    amount: d.total,
    partyName: d.customer?.name,
    paymentStatus: d.paymentStatus,
  }));
  const payables = openingPayables.map((d) => ({
    id: d._id,
    number: d.billNumber,
    date: d.billDate,
    dueDate: d.dueDate,
    amount: d.amounts?.netPayable,
    partyName: d.supplier?.name,
    paymentStatus: d.paymentStatus,
  }));

  return (
    <div className="space-y-6">
      {liveLocked && (
        <Alert className="border-amber-500/40">
          <Lock className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-sm">
            <strong>Opening balances are locked.</strong> Real transactions exist for this
            company, so the cutover is complete. To change opening figures now, reverse the
            relevant journal entries from the journal.
          </AlertDescription>
        </Alert>
      )}

      {/* Conversion (cutover) date — shared by receivables & payables */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversion date</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="conv-date" className="text-sm">
                Cutover date
              </Label>
              <Input
                id="conv-date"
                type="date"
                value={convDate}
                disabled={liveLocked}
                onChange={(e) => setConvDate(e.target.value)}
                className="w-full sm:w-52"
              />
            </div>
            <Button onClick={saveConversionDate} disabled={savingDate || liveLocked} variant="outline">
              {savingDate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save date
            </Button>
            <p className="text-xs text-muted-foreground sm:pb-2">
              Opening invoices and bills must be dated on or before this day.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Section A — trial balance (non-control accounts) */}
      <TrialBalanceSection setup={setup} conversionDate={conversionDate} />

      {/* Section B — opening receivables */}
      <OpeningDocsSection
        mode="receivable"
        parties={customers}
        docs={receivables}
        total={receivablesTotal}
        conversionDate={conversionDate}
        locked={liveLocked}
        onCreate={({ partyId, date, dueDate, amount }) =>
          createOpeningInvoice({ customerId: partyId, invoiceDate: date, dueDate, amount })
        }
        onReverse={(id) => reverseOpeningInvoice(id)}
      />

      {/* Section C — opening payables */}
      <OpeningDocsSection
        mode="payable"
        parties={suppliers}
        docs={payables}
        total={payablesTotal}
        conversionDate={conversionDate}
        locked={liveLocked}
        onCreate={({ partyId, date, dueDate, amount }) =>
          createOpeningBill({ supplierId: partyId, billDate: date, dueDate, amount })
        }
        onReverse={(id) => reverseOpeningBill(id)}
      />
    </div>
  );
}

function TrialBalanceSection({ setup, conversionDate }) {
  const { accounts, obeAccountId, alreadyPosted, openingBalanceEquity } = setup;

  // Uses the shared conversion date set at the top of the hub.
  const date = conversionDate ? conversionDate.slice(0, 10) : "";
  const [amounts, setAmounts] = useState({}); // { [id]: "1234.56" }
  const [result, setResult] = useState(null);
  const [isPending, startTransition] = useTransition();

  // Drop the OBE plug account and the AR/AP control accounts from the grid.
  const rows = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a._id !== obeAccountId &&
          !EXCLUDED_SYSTEM.has(a.systemAccount || "") &&
          !EXCLUDED_SUBTYPE.has(a.subType || ""),
      ),
    [accounts, obeAccountId],
  );

  const grouped = useMemo(() => {
    const map = {};
    for (const a of rows) (map[a.accountType] ||= []).push(a);
    return TYPE_ORDER.filter((t) => map[t]?.length).map((t) => [t, map[t]]);
  }, [rows]);

  const byId = useMemo(
    () => new Map(rows.map((a) => [a._id, a])),
    [rows],
  );

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const [id, v] of Object.entries(amounts)) {
      const a = byId.get(id);
      if (!a) continue;
      const value = amt(v);
      if (sideOf(a.accountType) === "debit") debit += value;
      else credit += value;
    }
    debit = Math.round(debit * 100) / 100;
    credit = Math.round(credit * 100) / 100;
    return { debit, credit, diff: Math.round((debit - credit) * 100) / 100 };
  }, [amounts, byId]);

  const onSubmit = () => {
    if (!date) {
      toast.error("Set your conversion (cutover) date at the top of the page first.");
      return;
    }
    const lines = Object.entries(amounts)
      .map(([accountId, v]) => {
        const a = byId.get(accountId);
        const value = amt(v);
        if (!a || value <= 0) return null;
        return sideOf(a.accountType) === "debit"
          ? { accountId, debit: value, credit: 0 }
          : { accountId, debit: 0, credit: value };
      })
      .filter(Boolean);

    if (lines.length === 0) {
      toast.error("Enter at least one opening balance.");
      return;
    }

    startTransition(async () => {
      const res = await postOpeningBalances({ entryDate: date, lines });
      if (res?.success) {
        toast.success(`Opening balances posted (${res.entryNumber}).`);
        setResult(res);
      } else {
        toast.error(res?.error || "Failed to post opening balances.");
      }
    });
  };

  // ── Already posted ──────────────────────────────────────────
  if (alreadyPosted && !result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            Opening balances already posted
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Entry{" "}
            <span className="font-mono font-medium">{alreadyPosted.entryNumber}</span>{" "}
            holds this company&apos;s opening balances. To re-enter them, reverse
            that journal entry first.
          </p>
          <ObeBanner balance={openingBalanceEquity} />
          <Button variant="outline" asChild>
            <Link href="/dashboard/journal">View journal entries</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Success ─────────────────────────────────────────────────
  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            Opening balances posted
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Posted as{" "}
            <span className="font-mono font-medium">{result.entryNumber}</span>.
            Your reports now start from these figures.
          </p>
          <ObeBanner balance={result.openingBalanceEquity} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/trial-balance">View trial balance</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/accounts">Back to accounts</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Entry form ──────────────────────────────────────────────
  const balanced = Math.abs(totals.diff) < 0.01;

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          Enter each account&apos;s balance on your start date. You&apos;ll see a{" "}
          <strong>Dr</strong>/<strong>Cr</strong> tag showing which side it posts
          to. Customer, supplier and stock balances aren&apos;t here — they come
          from your open invoices, bills and stock counts.
        </AlertDescription>
      </Alert>

      {/* Single bordered panel — consistent px-4 across every section keeps
          edges aligned (GitHub-style box rather than separate floating cards) */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Account groups */}
        {grouped.map(([type, accs], gi) => (
          <div key={type}>
            <div
              className={`px-4 py-2 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border ${
                gi > 0 ? "border-t" : ""
              }`}
            >
              {TYPE_LABEL[type]}
            </div>
            <ul className="divide-y divide-border">
              {accs.map((a) => {
                const side = sideOf(a.accountType);
                return (
                  <li
                    key={a._id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">{a.accountName}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {a.accountCode}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${
                          side === "debit"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                        }`}
                      >
                        {side === "debit" ? "Dr" : "Cr"}
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={amounts[a._id] ?? ""}
                        onChange={(e) =>
                          setAmounts((p) => ({ ...p, [a._id]: e.target.value }))
                        }
                        className="h-9 w-28 sm:w-36 text-right tabular-nums"
                        placeholder="0.00"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Totals */}
        <div className="border-t border-border bg-muted/20 p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Total debits</p>
            <p className="font-semibold tabular-nums">{formatCurrency(totals.debit)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total credits</p>
            <p className="font-semibold tabular-nums">{formatCurrency(totals.credit)}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground">To Opening Balance Equity</p>
            <p
              className={`font-semibold tabular-nums ${
                balanced ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {formatCurrency(Math.abs(totals.diff))}
              {!balanced && (
                <span className="ml-1 text-xs font-normal">
                  ({totals.diff > 0 ? "Cr" : "Dr"})
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Status + submit */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          {balanced ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
              Balanced — Opening Balance Equity will be zero.
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              The difference is parked in Opening Balance Equity — reclassify it
              to real equity later.
            </>
          )}
        </p>
        <Button onClick={onSubmit} disabled={isPending} className="w-full sm:w-auto shrink-0">
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Posting…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Post opening balances
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ObeBanner({ balance }) {
  if (!balance || Math.abs(balance) < 0.01) {
    return (
      <Alert className="border-green-500/40">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <AlertDescription className="text-sm">
          Opening Balance Equity is zero — nothing left to reclassify. Clean
          migration.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="border-amber-500/40">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertDescription className="text-sm">
        <strong>Opening Balance Equity holds {formatCurrency(Math.abs(balance))}</strong>{" "}
        ({balance > 0 ? "credit" : "debit"}). It&apos;s a temporary parking
        account — post a journal entry moving it into Owner&apos;s Capital /
        Retained Earnings so it reads zero.
      </AlertDescription>
    </Alert>
  );
}
