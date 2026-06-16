"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Send, Check, RotateCcw, Loader2 } from "lucide-react";
import {
  submitPettyCashReturn,
  approvePettyCashReturn,
  rejectPettyCashReturn,
} from "@/app/mongodb/actions/petty-cash-actions";
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
          onClick={() => run(() => submitPettyCashReturn(returnId), "Submitted to the MD")}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Submit to MD
        </Button>
      )}

      {canApprove && status === "submitted" && (
        <>
          <Button
            onClick={() => run(() => approvePettyCashReturn(returnId), "Approved")}
            disabled={isPending}
          >
            <Check className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const reason = window.prompt("Reason for sending back (optional):") || "";
              run(() => rejectPettyCashReturn(returnId, reason), "Sent back to custodian");
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
