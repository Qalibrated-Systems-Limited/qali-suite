"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  confirmSalesOrder,
  cancelSalesOrder,
  convertSalesOrderToInvoice,
} from "@/app/mongodb/actions/sales-order-actions";

// Lifecycle buttons for one sales order. Status drives what's offered:
//   draft     → Confirm (reserves stock) | Cancel
//   confirmed → Create Invoice (transfers reservation) | Cancel (releases)
export default function SalesOrderActions({ orderId, status }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (fn, okMsg, after) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        toast.success(okMsg);
        if (after) after(res);
        else router.refresh();
      } else {
        toast.error(res?.error || "Action failed");
      }
    });

  const onConfirm = () =>
    run(() => confirmSalesOrder(orderId), "Order confirmed — stock reserved");

  const onCancel = () => {
    const reason = window.prompt("Reason for cancelling (optional)") ?? null;
    if (reason === null) return; // dismissed the prompt
    run(() => cancelSalesOrder(orderId, reason), "Order cancelled — stock released");
  };

  const onInvoice = () =>
    run(
      () => convertSalesOrderToInvoice(orderId),
      "Draft invoice created",
      (res) => router.push(`/dashboard/invoices/${res.data.invoiceId}`),
    );

  if (status !== "draft" && status !== "confirmed") return null;

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <Button onClick={onConfirm} disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Confirm order
        </Button>
      )}
      {status === "confirmed" && (
        <Button onClick={onInvoice} disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Receipt className="mr-2 h-4 w-4" />
          )}
          Create invoice
        </Button>
      )}
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={isPending}
        className="border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        <XCircle className="mr-2 h-4 w-4" />
        Cancel order
      </Button>
    </div>
  );
}
