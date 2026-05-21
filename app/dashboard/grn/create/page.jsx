import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getBillById,
  getBillsAwaitingGRN,
} from "@/app/mongodb/queries/bill-queries";
import {
  getPurchaseOrderById,
  getOpenPurchaseOrders,
  fetchAllProducts,
} from "@/app/mongodb/queries/purchase-order-queries";
import GRNForm from "../components/GRNForm";

export const metadata = { title: "New Goods Receipt Note" };

export default async function GRNCreatePage(props) {
  const params = await props.searchParams;
  const fromBillId = params?.fromBill || null;
  const fromPOId = params?.fromPO || null;

  let prefill = null;
  let prefillError = null;

  // Fetch open POs + bills-awaiting-GRN in parallel so the form can
  // offer in-form pickers for both source types. Limited to receivable
  // POs (sent/confirmed/partial with outstanding lines) and strict-mode
  // bills that haven't been received yet (usedGRNI=true,
  // inventoryMoved=false).
  // Parallel: source pickers (POs / bills) + product catalogue for the
  // line picker. Same pattern POForm uses — pre-fetch once, filter on
  // the client. Avoids per-keystroke server hits on the GRN form.
  const [openPOs, awaitingBills, products] = await Promise.all([
    getOpenPurchaseOrders(),
    getBillsAwaitingGRN(),
    fetchAllProducts(),
  ]);

  if (fromBillId) {
    const bill = await getBillById(fromBillId);
    if (bill) {
      prefill = {
        sourceType: "bill",
        billId: bill._id?.toString?.() || bill._id,
        billNumber: bill.billNumber,
        supplierPartyId:
          bill.supplier?.partyId?.toString?.() || bill.supplier?.partyId,
        supplierName: bill.supplier?.name,
        receivedDate: new Date().toISOString().slice(0, 10),
        // Only stock-bearing lines (those tied to a product) are receivable;
        // service / expense / asset lines have nothing to physically receive.
        lines: (bill.lines || [])
          .filter((l) => l.product?.id)
          .map((l) => ({
            productId: l.product.id?.toString?.() || l.product.id,
            description: l.description || l.product.name || "",
            sku: l.product.SKU || l.product.sku || "",
            expectedQty: l.quantity || 0,
            receivedQty: l.quantity || 0,
            unit: l.unit || "pcs",
            packagingCondition: "good",
            physicalCondition: "good",
            inspectionNotes: "",
            storageLocation: "",
          })),
      };
    } else {
      prefillError = "bill";
    }
  } else if (fromPOId) {
    const po = await getPurchaseOrderById(fromPOId);
    if (po) {
      // Lines on the PO that still have something outstanding to receive.
      // line.quantity = ordered; line.receivedQuantity = already received.
      // Default the GRN line to the *outstanding* qty so partial receipts
      // don't accidentally double-count.
      const lines = (po.lines || [])
        .filter((l) => l.product?.id)
        .map((l) => {
          const ordered = l.quantity || 0;
          const alreadyReceived = l.receivedQuantity || 0;
          const outstanding = Math.max(0, ordered - alreadyReceived);
          return {
            productId: l.product.id?.toString?.() || l.product.id,
            description: l.description || l.product.name || "",
            sku: l.product.SKU || l.product.sku || "",
            expectedQty: outstanding,
            receivedQty: outstanding,
            unit: l.unit || "pcs",
            packagingCondition: "good",
            physicalCondition: "good",
            inspectionNotes: "",
            storageLocation: "",
          };
        })
        .filter((l) => l.expectedQty > 0);

      prefill = {
        sourceType: "purchase_order",
        purchaseOrderId: po._id?.toString?.() || po._id,
        poNumber: po.poNumber,
        supplierPartyId: po.supplier?.partyId?.toString?.() || po.supplier?.partyId,
        supplierName: po.supplier?.name,
        receivedDate: new Date().toISOString().slice(0, 10),
        lines,
      };
    } else {
      prefillError = "po";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link
            href={
              fromBillId
                ? `/dashboard/bills/${fromBillId}`
                : fromPOId
                ? `/dashboard/purchase-orders/${fromPOId}`
                : "/dashboard/grn"
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            New Goods Receipt Note
          </h1>
          <p className="text-sm text-muted-foreground">
            Inspect and document an incoming consignment
            {prefill?.poNumber && (
              <span> — receiving against PO <strong>{prefill.poNumber}</strong></span>
            )}
            {prefill?.billNumber && (
              <span> — receiving against Bill <strong>{prefill.billNumber}</strong></span>
            )}
          </p>
        </div>
      </div>

      {prefillError === "bill" && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-200">
            The referenced bill could not be loaded. Continuing as an
            unscheduled receipt — you&apos;ll need to add lines manually.
          </CardContent>
        </Card>
      )}
      {prefillError === "po" && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-200">
            The referenced purchase order could not be loaded. Continuing
            as an unscheduled receipt — you&apos;ll need to add lines
            manually.
          </CardContent>
        </Card>
      )}
      {fromPOId && prefill && prefill.lines.length === 0 && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-200">
            All lines on this PO have already been fully received. Add a
            line manually if there&apos;s an additional consignment.
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-6">
          <GRNForm
            prefill={prefill}
            availablePOs={openPOs}
            availableBills={awaitingBills}
            products={products}
          />
        </CardContent>
      </Card>
    </div>
  );
}
