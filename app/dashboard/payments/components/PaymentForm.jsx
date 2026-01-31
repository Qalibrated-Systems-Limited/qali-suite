"use client";

import { useState, useEffect, useCallback, useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  DollarSign,
  AlertTriangle,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createPayment,
  getUnpaidDocuments,
  getPaymentAccounts,
} from "@/app/mongodb/actions/payment-actions";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
];

const initialState = {
  success: false,
  error: null,
  fieldErrors: {},
  formData: null,
  data: null,
};

export function PaymentForm({ paymentType, parties = [] }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createPayment, initialState);

  // Form state - initialize from state.formData if present (for error recovery)
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [paymentMethod, setPaymentMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Method-specific
  const [mpesaTransactionCode, setMpesaTransactionCode] = useState("");
  const [mpesaPhoneNumber, setMpesaPhoneNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankTransactionReference, setBankTransactionReference] = useState("");

  // Accounts & Allocations
  const [accounts, setAccounts] = useState([]);
  const [unpaidDocs, setUnpaidDocs] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const isReceived = paymentType === "received";
  const docType = isReceived ? "invoice" : "bill";

  // Restore form data from state on error
  useEffect(() => {
    if (state.formData && !state.success) {
      setPartyId(state.formData.partyId || "");
      setAmount(state.formData.amount || "");
      setPaymentDate(state.formData.paymentDate || new Date().toISOString().split("T")[0]);
      setPaymentMethod(state.formData.paymentMethod || "");
      setAccountId(state.formData.accountId || "");
      setDescription(state.formData.description || "");
      setReference(state.formData.reference || "");
      setNotes(state.formData.notes || "");
      setMpesaTransactionCode(state.formData.mpesaTransactionCode || "");
      setMpesaPhoneNumber(state.formData.mpesaPhoneNumber || "");
      setBankName(state.formData.bankName || "");
      setChequeNumber(state.formData.chequeNumber || "");
      setBankTransactionReference(state.formData.bankTransactionReference || "");
      // Restore allocations if present
      if (state.formData.allocations) {
        try {
          const parsed = JSON.parse(state.formData.allocations);
          setAllocations(parsed);
        } catch {
          // ignore parse errors
        }
      }
    }
  }, [state]);

  // Handle success - redirect with success message in URL
  useEffect(() => {
    if (state.success && state.data) {
      const backUrl = isReceived
        ? "/dashboard/payments/received"
        : "/dashboard/payments/made";
      const params = new URLSearchParams({
        success: "true",
        message: `Payment ${state.data.paymentNumber} created as draft`,
      });
      router.push(`${backUrl}?${params.toString()}`);
    }
  }, [state.success, state.data, isReceived, router]);

  // Extract errors from state
  const error = state.error;
  const fieldErrors = state.fieldErrors || {};

  // Load payment accounts on mount
  useEffect(() => {
    async function loadAccounts() {
      setLoadingAccounts(true);
      const result = await getPaymentAccounts();
      if (result.success) {
        setAccounts(result.data);
      }
      setLoadingAccounts(false);
    }
    loadAccounts();
  }, []);

  // Load unpaid docs when party changes
  useEffect(() => {
    if (!partyId) {
      setUnpaidDocs([]);
      setAllocations([]);
      return;
    }

    async function loadDocs() {
      setLoadingDocs(true);
      const result = await getUnpaidDocuments(partyId, docType);
      if (result.success) {
        setUnpaidDocs(result.data);
      }
      setLoadingDocs(false);
    }
    loadDocs();
  }, [partyId, docType]);

  // Auto-generate description
  useEffect(() => {
    const party = parties.find((p) => p._id === partyId);
    if (party) {
      setDescription(
        isReceived
          ? `Payment received from ${party.name}`
          : `Payment to ${party.name}`
      );
    }
  }, [partyId, parties, isReceived]);

  const totalAllocated = allocations.reduce(
    (sum, a) => sum + (parseFloat(a.amountAllocated) || 0),
    0
  );
  const unapplied = Math.max(0, (parseFloat(amount) || 0) - totalAllocated);

  // Add allocation for a document
  const addAllocation = useCallback(
    (doc) => {
      if (allocations.find((a) => a.documentId === doc.id)) return;

      const remaining = Math.max(0, (parseFloat(amount) || 0) - totalAllocated);
      const allocAmount = Math.min(doc.balance, remaining);

      setAllocations((prev) => [
        ...prev,
        {
          documentType: docType,
          documentId: doc.id,
          documentNumber: doc.documentNumber,
          documentDate: doc.documentDate,
          originalAmount: doc.originalAmount,
          balanceBefore: doc.balance,
          amountAllocated: allocAmount > 0 ? allocAmount.toFixed(2) : "",
        },
      ]);
    },
    [allocations, amount, totalAllocated, docType]
  );

  const removeAllocation = (index) => {
    setAllocations((prev) => prev.filter((_, i) => i !== index));
  };

  const updateAllocationAmount = (index, value) => {
    setAllocations((prev) =>
      prev.map((a, i) => (i === index ? { ...a, amountAllocated: value } : a))
    );
  };

  // Auto-allocate: spread amount across documents oldest first
  const autoAllocate = () => {
    let remaining = parseFloat(amount) || 0;
    const newAllocations = unpaidDocs
      .filter((doc) => doc.balance > 0)
      .map((doc) => {
        const allocAmount = Math.min(doc.balance, remaining);
        remaining -= allocAmount;
        return {
          documentType: docType,
          documentId: doc.id,
          documentNumber: doc.documentNumber,
          documentDate: doc.documentDate,
          originalAmount: doc.originalAmount,
          balanceBefore: doc.balance,
          amountAllocated: allocAmount > 0 ? allocAmount.toFixed(2) : "0",
        };
      })
      .filter((a) => parseFloat(a.amountAllocated) > 0);

    setAllocations(newAllocations);
  };

  // Serialize allocations for form submission
  const allocationsJson = allocations.length > 0 ? JSON.stringify(allocations) : "";

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden inputs for form data */}
      <input type="hidden" name="paymentType" value={paymentType} />
      <input type="hidden" name="allocations" value={allocationsJson} />

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ============================================ */}
      {/* PARTY & BASIC INFO */}
      {/* ============================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {isReceived ? "Payment Details" : "Payment Details"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Party */}
            <div className="space-y-2">
              <Label>
                {isReceived ? "Customer" : "Supplier"}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <input type="hidden" name="partyId" value={partyId} />
              <Select value={partyId} onValueChange={setPartyId} disabled={isPending}>
                <SelectTrigger className={fieldErrors.partyId ? "border-destructive" : ""}>
                  <SelectValue
                    placeholder={`Select ${isReceived ? "customer" : "supplier"}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((party) => (
                    <SelectItem key={party._id} value={party._id}>
                      {party.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.partyId && (
                <p className="text-sm text-destructive">{fieldErrors.partyId}</p>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label>
                Amount <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  KES
                </span>
                <Input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={`pl-12 ${fieldErrors.amount ? "border-destructive" : ""}`}
                  disabled={isPending}
                />
              </div>
              {fieldErrors.amount && (
                <p className="text-sm text-destructive">{fieldErrors.amount}</p>
              )}
            </div>

            {/* Payment Date */}
            <div className="space-y-2">
              <Label>
                Payment Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                name="paymentDate"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={isPending}
              />
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>
                Payment Method <span className="text-destructive">*</span>
              </Label>
              <input type="hidden" name="paymentMethod" value={paymentMethod} />
              <Select
                value={paymentMethod}
                onValueChange={setPaymentMethod}
                disabled={isPending}
              >
                <SelectTrigger
                  className={fieldErrors.paymentMethod ? "border-destructive" : ""}
                >
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.paymentMethod && (
                <p className="text-sm text-destructive">{fieldErrors.paymentMethod}</p>
              )}
            </div>

            {/* Payment Account */}
            <div className="space-y-2">
              <Label>
                Payment Account <span className="text-destructive">*</span>
              </Label>
              <input type="hidden" name="accountId" value={accountId} />
              <Select
                value={accountId}
                onValueChange={setAccountId}
                disabled={isPending || loadingAccounts}
              >
                <SelectTrigger
                  className={fieldErrors.accountId ? "border-destructive" : ""}
                >
                  <SelectValue
                    placeholder={loadingAccounts ? "Loading..." : "Select account"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} - {a.name} ({a.subType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.accountId && (
                <p className="text-sm text-destructive">{fieldErrors.accountId}</p>
              )}
            </div>

            {/* Reference */}
            <div className="space-y-2">
              <Label>Reference</Label>
              <Input
                name="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g., cheque #, M-Pesa code"
                disabled={isPending}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>
              Description <span className="text-destructive">*</span>
            </Label>
            <Input
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Payment description"
              disabled={isPending}
              className={fieldErrors.description ? "border-destructive" : ""}
            />
            {fieldErrors.description && (
              <p className="text-sm text-destructive">{fieldErrors.description}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* METHOD-SPECIFIC DETAILS */}
      {/* ============================================ */}
      {paymentMethod === "mpesa" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">M-Pesa Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Transaction Code <span className="text-destructive">*</span>
                </Label>
                <Input
                  name="mpesaTransactionCode"
                  value={mpesaTransactionCode}
                  onChange={(e) =>
                    setMpesaTransactionCode(e.target.value.toUpperCase())
                  }
                  placeholder="e.g., SHK1234ABC"
                  disabled={isPending}
                  className={
                    fieldErrors.mpesaTransactionCode ? "border-destructive" : ""
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input
                  name="mpesaPhoneNumber"
                  value={mpesaPhoneNumber}
                  onChange={(e) => setMpesaPhoneNumber(e.target.value)}
                  placeholder="e.g., 0712345678"
                  disabled={isPending}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(paymentMethod === "bank_transfer" || paymentMethod === "cheque") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Bank Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Input
                  name="bankName"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g., KCB, Equity"
                  disabled={isPending}
                />
              </div>
              {paymentMethod === "cheque" && (
                <div className="space-y-2">
                  <Label>
                    Cheque Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    name="chequeNumber"
                    value={chequeNumber}
                    onChange={(e) => setChequeNumber(e.target.value)}
                    placeholder="Cheque number"
                    disabled={isPending}
                    className={fieldErrors.chequeNumber ? "border-destructive" : ""}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Transaction Reference</Label>
                <Input
                  name="bankTransactionReference"
                  value={bankTransactionReference}
                  onChange={(e) => setBankTransactionReference(e.target.value)}
                  placeholder="Bank reference"
                  disabled={isPending}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============================================ */}
      {/* ALLOCATIONS */}
      {/* ============================================ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Allocate to {isReceived ? "Invoices" : "Bills"}
            </CardTitle>
            {unpaidDocs.length > 0 && amount && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={autoAllocate}
                disabled={isPending}
              >
                Auto-Allocate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!partyId ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Select a {isReceived ? "customer" : "supplier"} to see outstanding{" "}
              {isReceived ? "invoices" : "bills"}.
            </p>
          ) : loadingDocs ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : unpaidDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No outstanding {isReceived ? "invoices" : "bills"} found for this{" "}
              {isReceived ? "customer" : "supplier"}.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Allocated documents */}
              {allocations.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          {isReceived ? "Invoice" : "Bill"} #
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          Original
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          Balance
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          Allocate
                        </th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allocations.map((alloc, i) => (
                        <tr key={alloc.documentId}>
                          <td className="px-3 py-2 font-medium">
                            {alloc.documentNumber}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {Number(alloc.originalAmount).toLocaleString("en-KE", {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {Number(alloc.balanceBefore).toLocaleString("en-KE", {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={alloc.balanceBefore}
                              value={alloc.amountAllocated}
                              onChange={(e) =>
                                updateAllocationAmount(i, e.target.value)
                              }
                              className="w-28 ml-auto text-right h-8"
                              disabled={isPending}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => removeAllocation(i)}
                              disabled={isPending}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Summary */}
              {allocations.length > 0 && (
                <div className="flex justify-end gap-6 text-sm px-3">
                  <div>
                    <span className="text-muted-foreground">Allocated: </span>
                    <span className="font-semibold">
                      KES{" "}
                      {totalAllocated.toLocaleString("en-KE", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Unapplied: </span>
                    <span
                      className={`font-semibold ${
                        unapplied > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600"
                      }`}
                    >
                      KES{" "}
                      {unapplied.toLocaleString("en-KE", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              )}

              {/* Available documents to add */}
              {unpaidDocs.filter(
                (doc) => !allocations.find((a) => a.documentId === doc.id)
              ).length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">
                    Outstanding {isReceived ? "Invoices" : "Bills"}
                  </p>
                  <div className="space-y-2">
                    {unpaidDocs
                      .filter(
                        (doc) =>
                          !allocations.find((a) => a.documentId === doc.id)
                      )
                      .map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                        >
                          <div>
                            <span className="font-medium">
                              {doc.documentNumber}
                            </span>
                            <span className="text-sm text-muted-foreground ml-3">
                              Due:{" "}
                              {doc.dueDate
                                ? new Date(doc.dueDate).toLocaleDateString(
                                    "en-KE",
                                    { day: "numeric", month: "short" }
                                  )
                                : "-"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">
                              Balance: KES{" "}
                              {doc.balance.toLocaleString("en-KE", {
                                minimumFractionDigits: 2,
                              })}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addAllocation(doc)}
                              disabled={isPending}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Add
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* NOTES */}
      {/* ============================================ */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={3}
              disabled={isPending}
            />
          </div>
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* SUBMIT */}
      {/* ============================================ */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            router.push(
              isReceived
                ? "/dashboard/payments/received"
                : "/dashboard/payments/made"
            )
          }
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <DollarSign className="mr-2 h-4 w-4" />
              Create Payment
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
