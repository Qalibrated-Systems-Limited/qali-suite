"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Send, Check, RotateCcw, Loader2 } from "lucide-react";
import {
  submitPettyCashReturnPg,
  approvePettyCashReturnPg,
  rejectPettyCashReturnPg,
} from "@/app/db/actions/petty-cash-actions";
import { PDFDownloadButton } from "@/components/pdf";
import { PettyCashReturnPDF } from "@/lib/pdf/documents";
import { toast } from "sonner";

// Workflow buttons for a return. Custodian submits a draft; the MD approves or
// sends a submitted return back. Everyone can download the form PDF.
export default function PettyCashWorkflow({ data, company, canSubmit, canApprove }) {
  const [isPending, startTransition] = useTransition();
  const returnId = data._id;
  const status = data.status;

  function run(fn, okMsg) {
    startTransition(async () => {
      const res = await fn();
      if (res.success) toast.success(okMsg);
      else toast.error(res.error || "Action failed");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PDFDownloadButton
        document={<PettyCashReturnPDF data={data} company={company} />}
        fileName={`${data.documentNumber || "petty-cash"}.pdf`}
      >
        Download form
      </PDFDownloadButton>

      {canSubmit && status === "draft" && (
        <Button
          onClick={() => run(() => submitPettyCashReturnPg(returnId), "Submitted for approval")}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Submit for approval
        </Button>
      )}

      {canApprove && status === "submitted" && (
        <>
          <Button
            onClick={() => run(() => approvePettyCashReturnPg(returnId), "Approved")}
            disabled={isPending}
          >
            <Check className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              // The reason is REQUIRED now, in the schema and in the database
              // (petty_cash_returns_rejection_has_reason). It was "optional"
              // here and defaulted server-side to "Returned for correction",
              // which sends a custodian back to a form with nothing to fix.
              const reason = window.prompt("Why is this being sent back?");
              if (reason === null) return; // cancelled
              if (reason.trim().length < 3) {
                window.alert("Give the custodian a reason to work from.");
                return;
              }
              run(
                () => rejectPettyCashReturnPg(returnId, reason.trim()),
                "Sent back to custodian",
              );
            }}
            disabled={isPending}
          >
            <RotateCcw className="h-4 w-4 mr-1" /> Send back
          </Button>
        </>
      )}
    </div>
  );
}
