"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Receipt,
  Building2,
  CreditCard,
  FileText,
  Loader2,
  Save,
  Send,
  Check,
  ChevronsUpDown,
  Plus,
  PenLine,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createExpense, quickExpense, updateExpense } from "@/app/mongodb/actions/expense-actions";
import { FileUpload } from "@/components/file-upload";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount || 0);
};

// ============================================
// VENDOR COMBOBOX - Select from parties or enter manually
// ============================================
function VendorCombobox({ vendors = [], defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(defaultValue ? "select" : "select"); // "select" or "manual"
  const [vendorId, setVendorId] = useState(defaultValue?.vendorId || "");
  const [vendorName, setVendorName] = useState(defaultValue?.name || "");
  const [vendorTaxPin, setVendorTaxPin] = useState(defaultValue?.taxPin || "");
  const [vendorPhone, setVendorPhone] = useState(defaultValue?.phone || "");
  const [vendorEmail, setVendorEmail] = useState(defaultValue?.email || "");

  const selectedVendor = vendors.find((v) => v._id === vendorId);

  // When vendor is selected, populate fields
  const handleSelect = (vendor) => {
    setVendorId(vendor._id);
    setVendorName(vendor.name);
    setVendorTaxPin(vendor.taxPin || "");
    setVendorPhone(vendor.phone || "");
    setVendorEmail(vendor.email || "");
    setMode("select");
    setOpen(false);
  };

  const handleManualEntry = () => {
    setVendorId("");
    setMode("manual");
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Hidden inputs for form submission */}
      <input type="hidden" name="vendorId" value={vendorId} />
      <input type="hidden" name="vendorName" value={vendorName} />
      <input type="hidden" name="vendorTaxPin" value={vendorTaxPin} />
      <input type="hidden" name="vendorPhone" value={vendorPhone} />
      <input type="hidden" name="vendorEmail" value={vendorEmail} />

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Vendor Selection */}
        <div className="space-y-2">
          <Label>
            Vendor / Payee <span className="text-destructive">*</span>
          </Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className={cn(
                  "w-full justify-between font-normal",
                  !vendorName && "text-muted-foreground",
                  error && "border-destructive"
                )}
              >
                {vendorName ? (
                  <span className="flex items-center gap-2 truncate">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    {vendorName}
                    {mode === "manual" && (
                      <span className="text-xs text-muted-foreground">(manual)</span>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Select or enter vendor...
                  </span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search vendors..." />
                <CommandList>
                  <CommandEmpty>No vendor found.</CommandEmpty>
                  <CommandGroup heading="Registered Vendors">
                    {vendors.map((vendor) => (
                      <CommandItem
                        key={vendor._id}
                        value={`${vendor.name} ${vendor.taxPin || ""}`}
                        onSelect={() => handleSelect(vendor)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            vendorId === vendor._id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{vendor.name}</span>
                          {vendor.taxPin && (
                            <span className="text-xs text-muted-foreground">
                              PIN: {vendor.taxPin}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={handleManualEntry}>
                      <PenLine className="mr-2 h-4 w-4" />
                      Enter vendor manually
                    </CommandItem>
                    <CommandItem asChild>
                      <Link
                        href="/dashboard/parties/create?type=supplier&returnTo=/dashboard/expenses/create"
                        className="flex items-center"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add new vendor
                      </Link>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* KRA PIN */}
        <div className="space-y-2">
          <Label htmlFor="vendorTaxPinDisplay">KRA PIN</Label>
          <Input
            id="vendorTaxPinDisplay"
            placeholder="e.g., P051234567X"
            value={vendorTaxPin}
            onChange={(e) => setVendorTaxPin(e.target.value)}
            disabled={mode === "select" && vendorId}
          />
        </div>
      </div>

      {/* Manual entry fields or editable when in manual mode */}
      {mode === "manual" && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="vendorNameManual">
              Vendor Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="vendorNameManual"
              placeholder="e.g., Kenya Power"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendorPhoneManual">Phone</Label>
            <Input
              id="vendorPhoneManual"
              placeholder="+254..."
              value={vendorPhone}
              onChange={(e) => setVendorPhone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendorEmailManual">Email</Label>
            <Input
              id="vendorEmailManual"
              type="email"
              placeholder="vendor@example.com"
              value={vendorEmail}
              onChange={(e) => setVendorEmail(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// ACCOUNT COMBOBOX - Searchable with quick add
// ============================================
function AccountCombobox({
  accounts = [],
  name,
  label,
  placeholder = "Select account...",
  defaultValue,
  error,
  required = false,
  createUrl,
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");

  const selectedAccount = accounts.find((a) => a._id === value);

  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            <span className="truncate">
              {selectedAccount
                ? `${selectedAccount.accountCode} - ${selectedAccount.accountName}`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search accounts..." />
            <CommandList>
              <CommandEmpty>No account found.</CommandEmpty>
              <CommandGroup>
                {accounts.map((account) => (
                  <CommandItem
                    key={account._id}
                    value={`${account.accountCode} ${account.accountName}`}
                    onSelect={() => {
                      setValue(account._id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === account._id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="font-mono text-sm">{account.accountCode}</span>
                    <span className="ml-2">{account.accountName}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {createUrl && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem asChild>
                      <Link
                        href={createUrl}
                        className="flex items-center"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add new account
                      </Link>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ============================================
// CATEGORY COMBOBOX - Searchable static list
// ============================================
function CategoryCombobox({ categories = [], defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");

  const selectedCategory = categories.find((c) => c.value === value);

  return (
    <div className="space-y-2">
      <Label>
        Category <span className="text-destructive">*</span>
      </Label>
      <input type="hidden" name="category" value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            {selectedCategory?.label || "Select category..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories..." />
            <CommandList>
              <CommandEmpty>No category found.</CommandEmpty>
              <CommandGroup>
                {categories.map((category) => (
                  <CommandItem
                    key={category.value}
                    value={category.label}
                    onSelect={() => {
                      setValue(category.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === category.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {category.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ============================================
// MAIN EXPENSE FORM
// ============================================
export default function ExpenseForm({
  expense = null,
  accounts = [],
  paymentAccounts = [],
  vendors = [],
  categories = [],
}) {
  const router = useRouter();
  const isEditing = !!expense;

  // Form state
  const [amount, setAmount] = useState(expense?.amount || "");
  const [taxRate, setTaxRate] = useState(expense?.taxRate || 0);
  const [taxAmount, setTaxAmount] = useState(expense?.taxAmount || 0);
  const [withholdingTax, setWithholdingTax] = useState(expense?.withholdingTax || 0);
  const [paymentMethod, setPaymentMethod] = useState(expense?.paymentMethod || "unpaid");
  const [paidFrom, setPaidFrom] = useState(expense?.paidFrom || "");
  const [isReimbursable, setIsReimbursable] = useState(expense?.isReimbursable || false);
  const [submitAndApprove, setSubmitAndApprove] = useState(false);
  const [receipts, setReceipts] = useState(expense?.receipts || []);

  // Calculate tax amount when rate or amount changes
  useEffect(() => {
    if (amount && taxRate > 0) {
      const calculated = (parseFloat(amount) * taxRate) / 100;
      setTaxAmount(Math.round(calculated * 100) / 100);
    } else {
      setTaxAmount(0);
    }
  }, [amount, taxRate]);

  // Calculate totals
  const subtotal = parseFloat(amount) || 0;
  const total = subtotal + taxAmount - withholdingTax;

  // Action handler
  const actionFn = isEditing
    ? updateExpense.bind(null, expense._id)
    : submitAndApprove
    ? quickExpense
    : createExpense;

  const [state, formAction, isPending] = useActionState(actionFn, {});

  // Handle successful submission
  useEffect(() => {
    if (state?.success) {
      router.push("/dashboard/expenses");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-6">
      {/* Error Display */}
      {state?.error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
          {state.error}
        </div>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Expense Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="expenseDate">
                Expense Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="expenseDate"
                name="expenseDate"
                type="date"
                defaultValue={
                  expense?.expenseDate?.split("T")[0] ||
                  new Date().toISOString().split("T")[0]
                }
                required
              />
            </div>

            {/* Category - Searchable */}
            <CategoryCombobox
              categories={categories}
              defaultValue={expense?.category}
              error={state?.fieldErrors?.category}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="description"
              name="description"
              placeholder="What was this expense for?"
              defaultValue={expense?.description || ""}
              required
              rows={2}
            />
          </div>

          {/* Expense Account - Searchable with quick add */}
          <AccountCombobox
            accounts={accounts}
            name="accountId"
            label="Expense Account"
            placeholder="Select expense account..."
            defaultValue={expense?.accountId}
            error={state?.fieldErrors?.accountId}
            required
            createUrl="/dashboard/accounts/create?type=expense&returnTo=/dashboard/expenses/create"
          />
        </CardContent>
      </Card>

      {/* Vendor Info - Searchable with options */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Vendor / Payee
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VendorCombobox
            vendors={vendors}
            defaultValue={expense?.vendor}
            error={state?.fieldErrors?.vendorName}
          />
        </CardContent>
      </Card>

      {/* Amount & Tax */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Amount & Tax
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">
                Amount (KES) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxRate">VAT Rate (%)</Label>
              <Select
                value={String(taxRate)}
                onValueChange={(v) => setTaxRate(parseFloat(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No VAT (0%)</SelectItem>
                  <SelectItem value="16">Standard (16%)</SelectItem>
                  <SelectItem value="8">Reduced (8%)</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="taxRate" value={taxRate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxAmount">VAT Amount</Label>
              <Input
                id="taxAmount"
                name="taxAmount"
                type="number"
                step="0.01"
                min="0"
                value={taxAmount}
                onChange={(e) => setTaxAmount(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="withholdingTax">Withholding Tax (KES)</Label>
              <Input
                id="withholdingTax"
                name="withholdingTax"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={withholdingTax}
                onChange={(e) => setWithholdingTax(parseFloat(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                WHT deducted at source (if applicable)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Total Payable</Label>
              <div className="h-10 px-3 py-2 bg-muted rounded-md flex items-center">
                <span className="text-lg font-bold tabular-nums">
                  {formatCurrency(total)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Amount + VAT - WHT
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Payment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <Select
                name="paymentMethod"
                value={paymentMethod}
                onValueChange={setPaymentMethod}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Not Paid Yet</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentMethod !== "unpaid" && (
              <AccountCombobox
                accounts={paymentAccounts}
                name="paidFrom"
                label="Paid From Account"
                placeholder="Select payment account..."
                defaultValue={paidFrom}
                error={state?.fieldErrors?.paidFrom}
                required
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Receipts */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Receipts & Attachments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <input type="hidden" name="receipts" value={JSON.stringify(receipts)} />
          <FileUpload
            value={receipts}
            onChange={setReceipts}
            folder="receipts"
            maxFiles={5}
          />
          <p className="text-xs text-muted-foreground mt-2">
            Attach receipt photos or PDFs for approval and audit trail
          </p>
        </CardContent>
      </Card>

      {/* Reference & Reimbursement */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Reference & Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reference">Reference Number</Label>
              <Input
                id="reference"
                name="reference"
                placeholder="e.g., Receipt #, Cheque #"
                defaultValue={expense?.reference || ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoiceNumber">Invoice Number</Label>
              <Input
                id="invoiceNumber"
                name="invoiceNumber"
                placeholder="Vendor invoice #"
                defaultValue={expense?.invoiceNumber || ""}
              />
            </div>
          </div>

          {/* Reimbursement */}
          <div className="flex items-start space-x-3 p-4 bg-muted/50 rounded-lg">
            <Checkbox
              id="isReimbursable"
              name="isReimbursable"
              checked={isReimbursable}
              onCheckedChange={setIsReimbursable}
              value="true"
            />
            <div className="space-y-1">
              <Label htmlFor="isReimbursable" className="cursor-pointer">
                Employee Reimbursement
              </Label>
              <p className="text-xs text-muted-foreground">
                Check if an employee paid out-of-pocket and needs reimbursement
              </p>
            </div>
          </div>

          {isReimbursable && (
            <div className="grid sm:grid-cols-2 gap-4 pl-7">
              <div className="space-y-2">
                <Label htmlFor="employeeName">Employee Name</Label>
                <Input
                  id="employeeName"
                  name="employeeName"
                  placeholder="Who paid?"
                  defaultValue={expense?.employeeName || ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employeeId">Employee ID</Label>
                <Input
                  id="employeeId"
                  name="employeeId"
                  placeholder="Optional"
                  defaultValue={expense?.employeeId || ""}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Additional notes..."
              defaultValue={expense?.notes || ""}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>

        {!isEditing && (
          <Button
            type="submit"
            variant="secondary"
            disabled={isPending}
            onClick={() => setSubmitAndApprove(false)}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save as Draft
          </Button>
        )}

        <Button
          type="submit"
          disabled={isPending}
          onClick={() => setSubmitAndApprove(!isEditing)}
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          {isEditing ? "Update Expense" : "Save & Submit"}
        </Button>
      </div>
    </form>
  );
}
