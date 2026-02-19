"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
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
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  Calendar,
  MapPin,
  Info,
} from "lucide-react";
import Link from "next/link";
import { settleAdvance } from "../../../mongodb/actions/claim-action";
import { toast } from "sonner";
import { FileUpload } from "@/components/file-upload";
import { format, isAfter, isBefore, parseISO } from "date-fns";
import ExpenseAccountCombobox from "@/components/expense-account-combobox";

// ============================================
// SUBMIT BUTTON COMPONENT
// ============================================
function SubmitButton({ pending, isValid, itemCount }) {
  return (
    <Button
      type="submit"
      disabled={pending || !isValid}
      className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold h-12 text-base disabled:opacity-50"
    >
      {pending ? (
        <>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Submitting Settlement...
        </>
      ) : (
        <>
          <Send className="w-5 h-5 mr-2" />
          Submit Settlement ({itemCount} item{itemCount !== 1 ? "s" : ""})
        </>
      )}
    </Button>
  );
}

// ============================================
// EXPENSE ITEM COMPONENT
// ============================================
function ExpenseItemCard({
  item,
  index,
  onUpdate,
  onRemove,
  canRemove,
  travelDates,
  advanceType,
  errors,
  expenseAccounts,
  onAccountCreated,
}) {
  const today = new Date().toISOString().split("T")[0];
  const minDate = travelDates?.from
    ? new Date(travelDates.from).toISOString().split("T")[0]
    : undefined;

  // Check if date is outside travel dates (only relevant for travel advances)
  const isDateOutsideTravel =
    advanceType === "travel" &&
    item.date &&
    travelDates?.from &&
    travelDates?.to &&
    (isBefore(parseISO(item.date), new Date(travelDates.from)) ||
      isAfter(parseISO(item.date), new Date(travelDates.to)));

  return (
    <div
      className={`p-5 sm:p-6 border-2 rounded-lg space-y-4 transition-colors ${
        errors
          ? "border-red-300 bg-red-50/30 dark:bg-red-900/10"
          : "border-border bg-muted/30 hover:border-yellow-500/30"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm sm:text-base font-semibold text-foreground">
            Expense #{index + 1}
          </span>
        </div>
        {canRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 h-9"
          >
            <Trash2 className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Remove</span>
          </Button>
        )}
      </div>

      {/* Error message for this item */}
      {errors && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-400">{errors}</p>
        </div>
      )}

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
            onChange={(e) => onUpdate("date", e.target.value)}
            max={today}
            className={`h-11 ${isDateOutsideTravel ? "border-orange-400" : ""}`}
          />
          {isDateOutsideTravel && (
            <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Date is outside travel period
            </p>
          )}
        </div>

        {/* Expense Account */}
        <div className="space-y-2">
          <Label className="text-sm sm:text-base font-medium">
            Expense Account <span className="text-red-500">*</span>
          </Label>
          <ExpenseAccountCombobox
            value={item.expenseAccountId}
            onValueChange={(id) => onUpdate("expenseAccountId", id)}
            accounts={expenseAccounts}
            onAccountCreated={onAccountCreated}
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
            onChange={(e) => onUpdate("description", e.target.value)}
            placeholder="e.g., Hotel accommodation for 2 nights at Safari Inn"
            className="h-11"
            minLength={3}
            maxLength={200}
          />
          <p className="text-xs text-muted-foreground">
            {item.description.length}/200 characters
          </p>
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label className="text-sm sm:text-base font-medium">
            Amount (KES) <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              KES
            </span>
            <Input
              type="number"
              required
              min="1"
              step="1"
              value={item.amount}
              onChange={(e) => onUpdate("amount", e.target.value)}
              placeholder="0"
              className="font-semibold text-lg h-11 pl-12"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label className="text-sm sm:text-base font-medium">
            Receipt/Notes{" "}
            <span className="text-muted-foreground">(Optional)</span>
          </Label>
          <Input
            type="text"
            value={item.notes}
            onChange={(e) => onUpdate("notes", e.target.value)}
            placeholder="Receipt #, vendor name, etc."
            className="h-11"
            maxLength={200}
          />
        </div>
      </div>

      {/* Item Total */}
      {item.amount > 0 && (
        <div className="pt-3 border-t flex justify-end">
          <span className="text-sm text-muted-foreground">
            Item Total:{" "}
            <span className="font-semibold text-foreground">
              KES {Number(item.amount).toLocaleString()}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN FORM COMPONENT
// ============================================
export function AdvanceSettlementForm({ advanceClaim, expenseAccounts = [] }) {
  const router = useRouter();
  const [allAccounts, setAllAccounts] = useState(expenseAccounts);

  const action = settleAdvance.bind(null, advanceClaim._id);
  const [state, formAction, pending] = useActionState(action, null);

  // Get the advance type for conditional rendering
  const advanceType = advanceClaim.advanceDetails?.advanceType || "travel";

  // Receipts state
  const [receipts, setReceipts] = useState([]);

  // Expense items state
  const [items, setItems] = useState([
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

  // Item-level errors
  const [itemErrors, setItemErrors] = useState({});

  // Calculate totals
  const totalSpent = items.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    return sum + amount;
  }, 0);

  const advanceAmount = advanceClaim.totalAmount;
  const balance = advanceAmount - totalSpent;

  // Validate items
  const isFormValid = items.every(
    (item) =>
      item.date &&
      item.expenseAccountId &&
      item.description.trim().length >= 3 &&
      parseFloat(item.amount) > 0
  );

  // Add new item
  const addItem = () => {
    if (items.length >= 50) {
      toast.error("Maximum 50 expense items allowed");
      return;
    }
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
      // Clear errors for removed item
      const newErrors = { ...itemErrors };
      delete newErrors[id];
      setItemErrors(newErrors);
    } else {
      toast.error("You must have at least one expense item");
    }
  };

  // Update item — when selecting an account, set both category and expenseAccountId
  const updateItem = (id, field, value) => {
    if (field === "expenseAccountId") {
      const account = allAccounts.find((a) => a._id === value);
      setItems(
        items.map((item) =>
          item.id === id
            ? { ...item, expenseAccountId: value, category: account?.accountName || "" }
            : item
        )
      );
    } else {
      setItems(
        items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    }
    // Clear error when user starts fixing
    if (itemErrors[id]) {
      const newErrors = { ...itemErrors };
      delete newErrors[id];
      setItemErrors(newErrors);
    }
  };

  // Handle form submission
  const handleSubmit = (formData) => {
    // Clear previous errors
    setItemErrors({});

    // Client-side validation
    const newErrors = {};
    let hasErrors = false;

    items.forEach((item, index) => {
      const errors = [];

      if (!item.date) errors.push("Date is required");
      if (!item.expenseAccountId) errors.push("Expense account is required");
      if (!item.description || item.description.trim().length < 3) {
        errors.push("Description must be at least 3 characters");
      }
      if (!item.amount || parseFloat(item.amount) <= 0) {
        errors.push("Amount must be greater than zero");
      }

      if (errors.length > 0) {
        newErrors[item.id] = errors.join(". ");
        hasErrors = true;
      }
    });

    if (hasErrors) {
      setItemErrors(newErrors);
      toast.error("Please fix the errors in your expense items");
      return;
    }

    // Add items as JSON to form data
    const itemsWithoutId = items.map(({ id, ...item }) => ({
      ...item,
      amount: parseFloat(item.amount),
    }));
    formData.append("items", JSON.stringify(itemsWithoutId));
    formAction(formData);
  };

  // Handle state changes
  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Settlement submitted successfully");
      // Show balance message
      if (state.balanceMessage) {
        setTimeout(() => {
          toast.info(state.balanceMessage, { duration: 5000 });
        }, 500);
      }
      router.push(`/dashboard/claims/${state.settlementId}`);
    } else if (state?.errors?._form) {
      state.errors._form.forEach((error) => toast.error(error));
    } else if (state?.existingSettlementId) {
      // Redirect to existing settlement
      toast.error("This advance has already been settled");
      setTimeout(() => {
        router.push(`/dashboard/claims/${state.existingSettlementId}`);
      }, 1500);
    }
  }, [state, router]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDateShort = (date) => {
    if (!date) return "N/A";
    return format(new Date(date), "PP");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="hover:bg-accent flex-shrink-0"
        >
          <Link href={`/dashboard/claims/${advanceClaim._id}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground truncate">
            Settle Advance
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {advanceClaim.claimNumber} • Submit receipts and actual expenses
          </p>
        </div>
      </div>

      {/* Advance Summary Card */}
      <Card className="p-5 sm:p-6 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-blue-200 dark:border-blue-800">
        <h3 className="font-semibold text-base sm:text-lg mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          Advance Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Advance Amount</p>
            <p className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-400">
              {formatCurrency(advanceAmount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Purpose</p>
            <p className="text-sm font-medium text-foreground line-clamp-2">
              {advanceClaim.advanceDetails?.purpose || "N/A"}
            </p>
          </div>
          {/* Travel-specific: Destination */}
          {advanceType === "travel" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                Destination
              </p>
              <p className="text-sm font-medium text-foreground">
                {advanceClaim.advanceDetails?.destination || "N/A"}
              </p>
            </div>
          )}
          {/* Travel-specific: Travel Period */}
          {advanceType === "travel" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Travel Period
              </p>
              <p className="text-sm font-medium text-foreground">
                {advanceClaim.advanceDetails?.travelDates?.from
                  ? `${formatDateShort(
                      advanceClaim.advanceDetails.travelDates.from
                    )} - ${formatDateShort(
                      advanceClaim.advanceDetails.travelDates.to
                    )}`
                  : "N/A"}
              </p>
            </div>
          )}
          {/* Linked Project */}
          {advanceClaim.project?.name && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Project</p>
              <p className="text-sm font-medium text-foreground">
                <span className="font-mono text-xs text-muted-foreground mr-1">
                  {advanceClaim.project.projectNumber}
                </span>
                {advanceClaim.project.name}
              </p>
            </div>
          )}
          {/* Non-travel types: Advance Type label */}
          {advanceType !== "travel" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Advance Type</p>
              <p className="text-sm font-medium text-foreground capitalize">
                {advanceType?.replace("_", " ") || "N/A"}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Form */}
      <form action={handleSubmit}>
        <div className="space-y-6 sm:space-y-8">
          {/* General Error */}
          {state?.errors?._form && (
            <Card className="p-4 sm:p-5 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-800 dark:text-red-300 mb-1">
                    Please fix the following errors:
                  </p>
                  <ul className="text-sm text-red-700 dark:text-red-400 space-y-1 list-disc list-inside">
                    {state.errors._form.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {/* Info Banner */}
          <Card className="p-4 sm:p-5 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm sm:text-base text-blue-800 dark:text-blue-300 font-medium mb-2">
                  How Settlement Works
                </p>
                <ul className="text-xs sm:text-sm text-blue-700 dark:text-blue-400 space-y-1">
                  <li className="flex items-start gap-2">
                    <span className="font-bold">1.</span>
                    <span>Add all your actual expenses with receipts</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">2.</span>
                    <span>
                      Your manager will review and approve the settlement
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">3.</span>
                    <span>
                      If you spent <strong>less</strong>: Return the balance to
                      the company
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">4.</span>
                    <span>
                      If you spent <strong>more</strong>: Company will reimburse
                      you
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>

          {/* Expense Items Card */}
          <Card className="p-5 sm:p-6 lg:p-8 space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <ReceiptIcon className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
                <h3 className="text-base sm:text-lg font-semibold">
                  Actual Expenses
                </h3>
                <span className="text-sm text-muted-foreground">
                  ({items.length} item{items.length !== 1 ? "s" : ""})
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addItem}
                disabled={items.length >= 50}
                className="border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Expense
              </Button>
            </div>

            {/* Items List */}
            <div className="space-y-4">
              {items.map((item, index) => (
                <ExpenseItemCard
                  key={item.id}
                  item={item}
                  index={index}
                  onUpdate={(field, value) => updateItem(item.id, field, value)}
                  onRemove={() => removeItem(item.id)}
                  canRemove={items.length > 1}
                  travelDates={advanceClaim.advanceDetails?.travelDates}
                  advanceType={advanceType}
                  errors={itemErrors[item.id]}
                  expenseAccounts={allAccounts}
                  onAccountCreated={(acc) =>
                    setAllAccounts((prev) =>
                      [...prev, acc].sort((a, b) =>
                        a.accountCode.localeCompare(b.accountCode),
                      ),
                    )
                  }
                />
              ))}
            </div>

            {/* Add More Button (when many items) */}
            {items.length >= 3 && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={addItem}
                  disabled={items.length >= 50}
                  className="text-yellow-600 hover:text-yellow-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Another Expense
                </Button>
              </div>
            )}
          </Card>

          {/* Settlement Summary Card */}
          <Card
            className={`p-5 sm:p-6 lg:p-8 border-2 ${
              balance > 0
                ? "bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border-red-200 dark:border-red-800"
                : balance < 0
                ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800"
                : "bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-900/20 dark:to-slate-900/20 border-gray-200 dark:border-gray-800"
            }`}
          >
            <h3 className="font-semibold text-base sm:text-lg mb-5 flex items-center gap-2">
              {balance > 0 ? (
                <AlertTriangle className="w-5 h-5 text-red-600" />
              ) : balance < 0 ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <CheckCircle className="w-5 h-5 text-gray-600" />
              )}
              Settlement Summary
            </h3>

            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-border">
                <span className="text-sm sm:text-base text-muted-foreground">
                  Advance Given
                </span>
                <span className="text-lg sm:text-xl font-bold text-foreground">
                  {formatCurrency(advanceAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-border">
                <span className="text-sm sm:text-base text-muted-foreground">
                  Total Spent ({items.length} items)
                </span>
                <span className="text-lg sm:text-xl font-bold text-foreground">
                  {formatCurrency(totalSpent)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-base sm:text-lg font-semibold text-foreground">
                  Balance
                </span>
                <div className="text-right">
                  <span
                    className={`text-2xl sm:text-3xl font-bold ${
                      balance > 0
                        ? "text-red-600 dark:text-red-400"
                        : balance < 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {formatCurrency(Math.abs(balance))}
                  </span>
                  <p
                    className={`text-xs sm:text-sm mt-1 font-medium ${
                      balance > 0
                        ? "text-red-600 dark:text-red-400"
                        : balance < 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {balance > 0
                      ? "⚠️ You will return this to the company"
                      : balance < 0
                      ? "✅ Company will reimburse you"
                      : "✅ Perfectly balanced!"}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Additional Notes */}
          <Card className="p-5 sm:p-6">
            <Label
              htmlFor="notes"
              className="text-sm sm:text-base font-medium mb-3 block"
            >
              Additional Notes{" "}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={500}
              placeholder={
                advanceType === "travel"
                  ? "Any additional information about your trip or expenses..."
                  : "Any additional information about your expenses..."
              }
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Maximum 500 characters
            </p>
          </Card>

          {/* Receipt Upload */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ReceiptIcon className="w-5 h-5 text-yellow-600" />
              <h3 className="font-semibold">Receipts & Attachments</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload photos of receipts to support your settlement expenses.
            </p>
            <input type="hidden" name="receipts" value={JSON.stringify(receipts)} />
            <FileUpload
              value={receipts}
              onChange={setReceipts}
              folder="claims"
              maxFiles={10}
            />
          </Card>

          {/* Validation Summary */}
          {!isFormValid && items.length > 0 && (
            <Card className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                <p className="text-sm">
                  Please complete all required fields in your expense items
                  before submitting.
                </p>
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4 justify-end">
            <Button
              type="button"
              variant="outline"
              asChild
              disabled={pending}
              className="h-12 text-base font-medium"
            >
              <Link href={`/dashboard/claims/${advanceClaim._id}`}>Cancel</Link>
            </Button>
            <SubmitButton
              pending={pending}
              isValid={isFormValid}
              itemCount={items.length}
            />
          </div>
        </div>
      </form>

      {/* Help Card */}
      <Card className="p-5 sm:p-6 bg-muted/50">
        <h4 className="font-semibold text-sm sm:text-base mb-3 flex items-center gap-2">
          <Info className="w-4 h-4" />
          What happens after settlement?
        </h4>
        <ol className="text-sm sm:text-base text-muted-foreground space-y-2">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500 text-black text-xs font-bold flex items-center justify-center">
              1
            </span>
            <span>
              Your manager reviews the settlement and actual expenses
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500 text-black text-xs font-bold flex items-center justify-center">
              2
            </span>
            <span>
              If approved, the accountant processes the journal entries
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500 text-black text-xs font-bold flex items-center justify-center">
              3
            </span>
            <span>
              Balance is settled:{" "}
              {balance > 0
                ? "you return the excess to the company"
                : balance < 0
                ? "you receive the additional amount"
                : "no further action needed"}
            </span>
          </li>
        </ol>
      </Card>
    </div>
  );
}
