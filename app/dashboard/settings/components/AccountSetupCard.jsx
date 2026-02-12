"use client";

import { useState, useEffect, useTransition } from "react";
import { Wallet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureAdvanceAccountsExist } from "@/app/mongodb/actions/account-actions";

export default function AccountSetupCard() {
  const [status, setStatus] = useState("loading"); // loading, missing, complete
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setStatus("loading");
    try {
      // Call the action which checks and returns status
      const result = await ensureAdvanceAccountsExist();
      if (result.success) {
        // Check if any were created or all existed
        const allExist = result.results?.every((r) => r.action === "exists");
        setStatus(allExist ? "complete" : "complete");
        setMessage(
          allExist
            ? "All advance accounts are configured"
            : `Setup complete: ${result.results?.map((r) => `${r.account} ${r.action}`).join(", ")}`
        );
      } else {
        setStatus("error");
        setMessage(result.error || "Failed to check account status");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Error checking accounts");
    }
  };

  const handleSetup = () => {
    startTransition(async () => {
      const result = await ensureAdvanceAccountsExist();
      if (result.success) {
        setStatus("complete");
        setMessage(
          `Setup complete: ${result.results?.map((r) => `${r.account} ${r.action}`).join(", ")}`
        );
      } else {
        setStatus("error");
        setMessage(result.error || "Setup failed");
      }
    });
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-4">
        <div
          className={`rounded-lg p-3 ${
            status === "complete"
              ? "bg-emerald-500/10"
              : status === "error"
                ? "bg-red-500/10"
                : "bg-amber-500/10"
          }`}
        >
          {status === "loading" || isPending ? (
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          ) : status === "complete" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : status === "error" ? (
            <AlertCircle className="h-5 w-5 text-red-500" />
          ) : (
            <Wallet className="h-5 w-5 text-amber-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium">Advance Accounts</h3>
          <p className="text-sm text-muted-foreground">
            {status === "loading" || isPending
              ? "Checking account setup..."
              : status === "complete"
                ? "Supplier & Customer advance accounts are ready"
                : status === "error"
                  ? message
                  : "Setup accounts for handling overpayments"}
          </p>

          {message && status === "complete" && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              {message}
            </p>
          )}
        </div>

        {status !== "loading" && status !== "complete" && (
          <Button
            size="sm"
            onClick={handleSetup}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Setting up...
              </>
            ) : (
              "Setup Now"
            )}
          </Button>
        )}

        {status === "complete" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 rounded">
            Configured
          </span>
        )}
      </div>
    </div>
  );
}
