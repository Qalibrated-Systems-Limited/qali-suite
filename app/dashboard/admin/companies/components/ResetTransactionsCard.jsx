"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Loader2, Eraser } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resetCompanyTransactions } from "@/app/mongodb/actions/company-actions";

// SuperAdmin danger zone: wipe a company's transactional data (the
// "clear the test data, go live" operation). Master data survives;
// the exact company name must be typed to arm the button.
export default function ResetTransactionsCard({ companyId, companyName }) {
  const action = resetCompanyTransactions.bind(null, companyId);
  const [state, formAction, isPending] = useActionState(action, {});
  const [typed, setTyped] = useState("");
  const armed = typed === companyName;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Danger zone — reset transactional data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Deletes ALL transactions for <strong>{companyName}</strong> —
          invoices, quotes, sales orders, payments, bills, journal entries,
          expenses, claims, stock movements, approvals, notifications, CRM
          records — and restarts document numbering.{" "}
          <strong>Kept:</strong> users, settings, chart of accounts
          (balances zeroed), products (stock zeroed), customers &amp;
          suppliers (balances zeroed), categories.
        </p>
        <p className="text-xs font-medium text-destructive">
          Irreversible. Take a database backup (mongodump) first.
        </p>

        {state.success && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            {state.message}
          </div>
        )}
        {state.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Type the company name to confirm:{" "}
              <span className="font-mono">{companyName}</span>
            </label>
            <input
              name="confirmName"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={companyName}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="wipeParties" className="h-4 w-4" />
            Also delete customers, suppliers &amp; employee records
            (test parties)
          </label>
          <Button
            type="submit"
            variant="destructive"
            disabled={!armed || isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eraser className="mr-2 h-4 w-4" />
            )}
            Reset transactional data
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
