"use client";

import { useActionState, useState, useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disburseLoan } from "@/app/mongodb/actions/loan-actions";

const DISBURSEMENT_METHODS = [
  { value: "bank", label: "Bank Transfer" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
];

const initialState = { success: false, error: null, fieldErrors: null };

export default function DisburseForm({ loanId, onSuccess, onCancel }) {
  const [state, formAction, isPending] = useActionState(disburseLoan, initialState);
  const [accounts, setAccounts] = useState({ asset: [], bank: [] });
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // Fetch GL accounts on mount
  useEffect(() => {
    async function loadAccounts() {
      try {
        const res = await fetch("/api/accounts/by-type?types=asset,bank,cash");
        if (res.ok) {
          const data = await res.json();
          setAccounts({
            asset: data.asset || [],
            bank: [...(data.bank || []), ...(data.cash || [])],
          });
        }
      } catch {
        // If API is not available, leave empty and let user type manually
      } finally {
        setLoadingAccounts(false);
      }
    }
    loadAccounts();
  }, []);

  if (state.success) {
    onSuccess?.();
    return null;
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="loanId" value={loanId} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Disbursement Method */}
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Disbursement Method <span className="text-destructive">*</span>
        </label>
        <select
          name="disbursementMethod"
          className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.disbursementMethod ? "border-destructive" : "border-border"}`}
        >
          <option value="">Select method...</option>
          {DISBURSEMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {state.fieldErrors?.disbursementMethod && (
          <p className="mt-1 text-xs text-destructive">{state.fieldErrors.disbursementMethod}</p>
        )}
      </div>

      {/* Reference */}
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Reference
        </label>
        <input
          type="text"
          name="disbursementRef"
          placeholder="e.g. Bank ref, M-Pesa code, cheque number..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Staff Loans Receivable Account */}
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Staff Loans Receivable Account <span className="text-destructive">*</span>
        </label>
        {loadingAccounts ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts...
          </div>
        ) : (
          <select
            name="staffLoansAccountId"
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.staffLoansAccountId ? "border-destructive" : "border-border"}`}
          >
            <option value="">Select asset account...</option>
            {accounts.asset.map((a) => (
              <option key={a._id} value={a._id}>
                {a.accountCode} - {a.accountName}
              </option>
            ))}
          </select>
        )}
        {state.fieldErrors?.staffLoansAccountId && (
          <p className="mt-1 text-xs text-destructive">{state.fieldErrors.staffLoansAccountId}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Debit account (asset) to record the receivable</p>
      </div>

      {/* Bank/Cash Account */}
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Bank / Cash Account <span className="text-destructive">*</span>
        </label>
        {loadingAccounts ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts...
          </div>
        ) : (
          <select
            name="bankAccountId"
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.bankAccountId ? "border-destructive" : "border-border"}`}
          >
            <option value="">Select bank/cash account...</option>
            {accounts.bank.map((a) => (
              <option key={a._id} value={a._id}>
                {a.accountCode} - {a.accountName}
              </option>
            ))}
          </select>
        )}
        {state.fieldErrors?.bankAccountId && (
          <p className="mt-1 text-xs text-destructive">{state.fieldErrors.bankAccountId}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Credit account (bank/cash) for the disbursement</p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPending ? "Disbursing..." : "Confirm Disbursement"}
        </Button>
      </div>
    </form>
  );
}
