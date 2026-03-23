"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateLeaveBalance } from "@/app/mongodb/actions/hr-employee-actions";

const initialState = { success: false, error: null };

// One mini-form per leave type — each saves independently
function LeaveBalanceRow({ profileId, balance }) {
  const [state, formAction, isPending] = useActionState(updateLeaveBalance, initialState);

  const available = balance.entitledDays + balance.carryOver - balance.usedDays;

  return (
    <form action={formAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="leaveType" value={balance.leaveType} />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground capitalize">
            {balance.label || balance.leaveType.replace("_", " ")}
          </h3>
          <p className="text-xs text-muted-foreground">Year {balance.year}</p>
        </div>
        <div className="flex items-center gap-2">
          {state.success && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {state.error && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {state.error}
            </span>
          )}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      {/* Read-only usage info */}
      <div className="mb-4 grid grid-cols-3 gap-3 rounded-md bg-muted/40 p-3 text-center text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Used</p>
          <p className="font-semibold text-red-600 dark:text-red-400">{balance.usedDays}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="font-semibold text-yellow-600 dark:text-yellow-400">{balance.pendingDays}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Available</p>
          <p className={`font-semibold ${available <= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
            {available}
          </p>
        </div>
      </div>

      {/* Editable fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Entitled Days <span className="text-destructive">*</span>
          </label>
          <input
            name="entitledDays"
            type="number"
            min="0"
            step="1"
            defaultValue={balance.entitledDays}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Carry-Over Days</label>
          <input
            name="carryOver"
            type="number"
            min="0"
            step="1"
            defaultValue={balance.carryOver}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Balance = Entitled + Carry-Over − Used days. Used and pending days cannot be edited here.
      </p>
    </form>
  );
}

export default function LeaveBalanceForm({ profileId, balances }) {
  return (
    <div className="space-y-4">
      {balances.map((balance) => (
        <LeaveBalanceRow key={balance.leaveType} profileId={profileId} balance={balance} />
      ))}
    </div>
  );
}
