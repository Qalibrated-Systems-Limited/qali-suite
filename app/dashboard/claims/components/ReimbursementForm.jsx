"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Loader2,
  Send,
  Plus,
  Trash2,
  Receipt as ReceiptIcon,
  DollarSign,
  Upload,
} from "lucide-react";
import Link from "next/link";
import {
  createReimbursement,
  updateClaim,
} from "@/app/mongodb/actions/claim-action";
import { toast } from "sonner";
import { useActionState } from "react";
import { FileUpload } from "@/components/file-upload";
import ProjectPicker from "@/components/project-picker";
import ExpenseAccountCombobox from "@/components/expense-account-combobox";

function SubmitButton({ isEdit, pending }) {
  return (
    <Button
      type="submit"
      disabled={pending}
      className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold h-12 text-base"
    >
      {pending ? (
        <>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          {isEdit ? "Updating..." : "Submitting..."}
        </>
      ) : (
        <>
          <Send className="w-5 h-5 mr-2" />
          {isEdit ? "Update Claim" : "Submit Claim"}
        </>
      )}
    </Button>
  );
}

export function ReimbursementForm({ claim = null, expenseAccounts = [], projects = [] }) {
  const router = useRouter();
  const isEdit = !!claim;
  const [allAccounts, setAllAccounts] = useState(expenseAccounts);

  // Project selection (optional)
  const [projectId, setProjectId] = useState(claim?.projectId || "");

  // Use different action based on mode
  const action = isEdit
    ? updateClaim.bind(null, claim._id)
    : createReimbursement;

  // CRITICAL: initial state must be null so state?.values works correctly
  const [state, formAction, pending] = useActionState(action, null);

  // Receipts state
  const [receipts, setReceipts] = useState(claim?.receipts || []);

  // Expense items state - initialize with claim data if editing
  const [items, setItems] = useState(
    claim?.items?.map((item, index) => ({
      id: Date.now() + index,
      date: new Date(item.date).toISOString().split("T")[0],
      category: item.category,
      expenseAccountId: item.expenseAccountId || "",
      description: item.description,
      amount: item.amount.toString(),
      notes: item.notes || "",
    })) || [
      {
        id: Date.now(),
        date: new Date().toISOString().split("T")[0],
        category: "",
        expenseAccountId: "",
        description: "",
        amount: "",
        notes: "",
      },
    ]
  );

  // Calculate total
  const total = items.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    return sum + amount;
  }, 0);

  // Add new item
  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now(),
        date: new Date().toISOString().split("T")[0],
        category: "",
        expenseAccountId: "",
        description: "",
        amount: "",
        notes: "",
      },
    ]);
  };

  // Remove item
  const removeItem = (id) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id));
    } else {
      toast.error("You must have at least one expense item");
    }
  };

  // Update item — when selecting an account, set both category and expenseAccountId
  const updateItem = (id, field, value) => {
    if (field === "expenseAccountId") {
      const account = expenseAccounts.find((a) => a._id === value);
      setItems(
        items.map((item) =>
          item.id === id
            ? { ...item, expenseAccountId: value, category: account?.accountName || "" }
            : item
        )
      );
      return;
    }
    setItems(
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  // Handle form submission
  const handleSubmit = (formData) => {
    // Add items as JSON to form data
    const itemsWithoutId = items.map(({ id, ...item }) => item);
    formData.append("items", JSON.stringify(itemsWithoutId));
    formAction(formData);
  };

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Reimbursement claim saved successfully");
      if (isEdit) {
        router.push(`/dashboard/claims/${claim._id}`);
      } else {
        router.push(`/dashboard/claims/${state.claimId}`);
      }
    } else if (state?.errors?._form) {
      toast.error(state.errors._form[0]);
    }
  }, [state, router, isEdit, claim]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="hover:bg-accent shrink-0"
        >
          <Link
            href={
              isEdit ? `/dashboard/claims/${claim._id}` : "/dashboard/my-claims"
            }
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground truncate">
            {isEdit ? `Edit ${claim.claimNumber}` : "New Reimbursement Claim"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {isEdit
              ? "Update your reimbursement claim details"
              : "Request reimbursement for business expenses you paid"}
          </p>
        </div>
      </div>

      {/* Form */}
      <form action={handleSubmit}>
        <div className="space-y-6 sm:space-y-8">
          {/* Basic Info Card */}
          <Card className="p-5 sm:p-6 lg:p-8 space-y-6">
            {/* General Error */}
            {state?.errors?._form && (
              <div className="p-4 sm:p-5 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm sm:text-base text-red-800 dark:text-red-300 font-medium">
                  {state.errors._form[0]}
                </p>
              </div>
            )}

            {/* Info Banner */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-4 sm:p-5">
              <p className="text-sm sm:text-base text-blue-800 dark:text-blue-300">
                💡 <strong>Tip:</strong> Upload clear photos of all receipts.
                Ensure dates and amounts are visible.
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2.5">
              <Label
                htmlFor="description"
                className="text-sm sm:text-base font-medium"
              >
                Claim Description <span className="text-red-500">*</span>
              </Label>
              <Input
                id="description"
                name="description"
                type="text"
                required
                minLength={10}
                placeholder="e.g., Client meeting expenses in Nairobi"
                defaultValue={state?.values?.description ?? claim?.description ?? ""}
                key={`desc-${state?.values?.description ?? "init"}`}
                className="h-12"
              />
              {state?.errors?.description && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {state.errors.description[0]}
                </p>
              )}
              <p className="text-xs sm:text-sm text-muted-foreground">
                Minimum 10 characters - provide a clear summary
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-2.5">
              <Label
                htmlFor="notes"
                className="text-sm sm:text-base font-medium"
              >
                Additional Notes (Optional)
              </Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Any additional context for your manager..."
                defaultValue={state?.values?.notes ?? claim?.notes ?? ""}
                key={`notes-${state?.values?.notes ?? "init"}`}
                className="resize-none"
              />
            </div>

            {/* Project Selection (optional) */}
            {projects.length > 0 && (
              <div className="space-y-2.5">
                <Label className="text-sm sm:text-base font-medium">
                  Link to Project <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </Label>
                <input type="hidden" name="projectId" value={projectId} />
                <ProjectPicker
                  value={projectId}
                  onValueChange={setProjectId}
                  projects={projects}
                  placeholder="Select a project..."
                />
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Link this reimbursement to a project for budget tracking
                </p>
              </div>
            )}
          </Card>

          {/* Expense Items Card */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ReceiptIcon className="w-5 h-5 text-yellow-600" />
                <h3 className="font-semibold">Expense Items</h3>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addItem}
                className="border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </Button>
            </div>

            {/* Items List */}
            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="p-5 sm:p-6 border-2 border-border rounded-lg space-y-4 bg-muted/30 hover:border-yellow-500/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm sm:text-base font-semibold text-foreground">
                      Item #{index + 1}
                    </span>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeItem(item.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 h-9"
                      >
                        <Trash2 className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Remove</span>
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Date */}
                    <div className="space-y-2">
                      <Label className="text-sm sm:text-base font-medium">
                        Date <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="date"
                        required
                        value={item.date}
                        onChange={(e) =>
                          updateItem(item.id, "date", e.target.value)
                        }
                        max={new Date().toISOString().split("T")[0]}
                        className="h-11"
                      />
                    </div>

                    {/* Expense Account */}
                    <div className="space-y-2">
                      <Label className="text-sm sm:text-base font-medium">
                        Expense Account <span className="text-red-500">*</span>
                      </Label>
                      <ExpenseAccountCombobox
                        value={item.expenseAccountId}
                        onValueChange={(id) =>
                          updateItem(item.id, "expenseAccountId", id)
                        }
                        accounts={allAccounts}
                        onAccountCreated={(acc) =>
                          setAllAccounts((prev) =>
                            [...prev, acc].sort((a, b) =>
                              a.accountCode.localeCompare(b.accountCode),
                            ),
                          )
                        }
                        placeholder="Select expense account..."
                        className="h-11"
                      />
                    </div>

                    {/* Description */}
                    <div className="space-y-2 sm:col-span-2">
                      <Label className="text-sm sm:text-base font-medium">
                        Description <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="text"
                        required
                        value={item.description}
                        onChange={(e) =>
                          updateItem(item.id, "description", e.target.value)
                        }
                        placeholder="e.g., Taxi to client office"
                        className="h-11"
                      />
                    </div>

                    {/* Amount */}
                    <div className="space-y-2">
                      <Label className="text-sm sm:text-base font-medium">
                        Amount (KES) <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="number"
                        required
                        min="1"
                        step="0.01"
                        value={item.amount}
                        onChange={(e) =>
                          updateItem(item.id, "amount", e.target.value)
                        }
                        placeholder="0.00"
                        className="font-semibold text-lg h-11"
                      />
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label className="text-sm sm:text-base font-medium">
                        Notes (Optional)
                      </Label>
                      <Input
                        type="text"
                        value={item.notes}
                        onChange={(e) =>
                          updateItem(item.id, "notes", e.target.value)
                        }
                        placeholder="Additional details..."
                        className="h-11"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex justify-end pt-5 border-t border-border">
              <div className="text-right space-y-1">
                <p className="text-sm sm:text-base text-muted-foreground font-medium">
                  Total Amount
                </p>
                <p className="text-3xl sm:text-4xl font-bold text-yellow-600 dark:text-yellow-400">
                  {formatCurrency(total)}
                </p>
              </div>
            </div>
          </Card>

          {/* Receipt Upload */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-yellow-600" />
              <h3 className="font-semibold">Receipts & Attachments</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload photos of receipts, invoices, or other supporting documents.
            </p>
            <input type="hidden" name="receipts" value={JSON.stringify(receipts)} />
            <FileUpload
              value={receipts}
              onChange={setReceipts}
              folder="claims"
              maxFiles={10}
            />
          </Card>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4 justify-end">
            <Button
              type="button"
              variant="outline"
              asChild
              className="h-12 text-base font-medium"
            >
              <Link href="/dashboard/my-claims">Cancel</Link>
            </Button>
            <SubmitButton isEdit={isEdit} pending={pending} />
          </div>
        </div>
      </form>

      {/* Help Card */}
      <Card className="p-5 sm:p-6 bg-muted/50">
        <h4 className="font-semibold text-sm sm:text-base mb-3">
          📋 What happens next?
        </h4>
        <ol className="text-sm sm:text-base text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Your manager will review your claim and receipts</li>
          <li>If approved, the accountant will process payment</li>
          <li>Payment will be made to your account</li>
          <li>You'll receive a notification when payment is complete</li>
        </ol>
      </Card>
    </div>
  );
}
