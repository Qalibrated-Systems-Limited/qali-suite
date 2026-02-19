"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncChartOfAccounts } from "@/app/mongodb/actions/account-actions";

export default function ChartOfAccountsSyncCard() {
  const [status, setStatus] = useState("idle"); // idle, syncing, complete, error
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState(null);

  const handleSync = () => {
    startTransition(async () => {
      setStatus("syncing");
      try {
        const res = await syncChartOfAccounts();
        if (res.success) {
          setStatus("complete");
          setResult(res);
        } else {
          setStatus("error");
          setResult({ message: res.error });
        }
      } catch (error) {
        setStatus("error");
        setResult({ message: error.message || "Sync failed" });
      }
    });
  };

  const loading = status === "syncing" || isPending;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-4">
        <div
          className={`rounded-lg p-3 ${
            status === "complete"
              ? "bg-emerald-500/10"
              : status === "error"
                ? "bg-red-500/10"
                : "bg-blue-500/10"
          }`}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          ) : status === "complete" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : status === "error" ? (
            <AlertCircle className="h-5 w-5 text-red-500" />
          ) : (
            <RefreshCw className="h-5 w-5 text-blue-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium">Sync Chart of Accounts</h3>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Checking for missing accounts..."
              : status === "complete"
                ? result?.created === 0
                  ? "All standard accounts are present"
                  : result?.message
                : status === "error"
                  ? result?.message
                  : "Create any missing standard accounts from the template"}
          </p>

          {status === "complete" && result?.accounts?.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
              {result.accounts.map((a) => (
                <div key={a.accountCode}>
                  <span className="font-mono">{a.accountCode}</span>{" "}
                  {a.accountName}
                </div>
              ))}
            </div>
          )}
        </div>

        {status !== "complete" && (
          <Button
            size="sm"
            variant={status === "error" ? "destructive" : "default"}
            onClick={handleSync}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Syncing...
              </>
            ) : status === "error" ? (
              "Retry"
            ) : (
              "Sync Now"
            )}
          </Button>
        )}

        {status === "complete" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 rounded whitespace-nowrap">
            {result?.created === 0 ? "Up to date" : `${result?.created} added`}
          </span>
        )}
      </div>
    </div>
  );
}
