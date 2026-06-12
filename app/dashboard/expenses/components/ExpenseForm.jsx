"use client";

import { useActionState } from "react";
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
  AlertCircle,
  Truck,
  X,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createExpense, updateExpense } from "@/app/mongodb/actions/expense-actions";
import { FileUpload } from "@/components/file-upload";
import ProjectPicker from "@/components/project-picker";
import ExpenseAccountCombobox from "@/components/expense-account-combobox";

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
function VendorCombobox({ vendors = [], employees = [], defaultValue, error, onVendorCreated }) {
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [mode, setMode] = useState("select"); // "select" or "manual"
  const [vendorId, setVendorId] = useState(defaultValue?.vendorId || "");
  const [vendorName, setVendorName] = useState(defaultValue?.name || "");
  const [vendorTaxPin, setVendorTaxPin] = useState(defaultValue?.taxPin || "");
  const [vendorPhone, setVendorPhone] = useState(defaultValue?.phone || "");
  const [vendorEmail, setVendorEmail] = useState(defaultValue?.email || "");
  // "supplier" | "employee" — employees are valid payees (advances /
  // reimbursements booked directly by accounts).
  const [vendorType, setVendorType] = useState(defaultValue?.partyType || "supplier");

  // When a payee is selected, populate fields
  const handleSelect = (vendor, kind = "supplier") => {
    setVendorId(vendor._id);
    setVendorName(vendor.name);
    setVendorTaxPin(vendor.taxPin || "");
    setVendorPhone(vendor.phone || "");
    setVendorEmail(vendor.email || "");
    setVendorType(kind);
    setMode("select");
    setOpen(false);
  };

  const handleManualEntry = () => {
    setVendorId("");
    setVendorType("supplier");
    setMode("manual");
    setOpen(false);
  };

  async function handleCreateVendor(e) {
    e.preventDefault();
    e.stopPropagation();
    setCreating(true);
    setCreateError("");

    const formData = new FormData(e.target);
    formData.set("type", "supplier");
    const { quickCreateParty } = await import("@/app/mongodb/actions/party-actions");
    const result = await quickCreateParty(formData);

    if (result.success) {
      handleSelect({
        _id: result.party._id,
        name: result.party.name,
        taxPin: result.party.taxPin || "",
        phone: result.party.phone || "",
        email: result.party.email || "",
      });
      onVendorCreated?.(result.party);
      setDialogOpen(false);
      e.target.reset();
    } else {
      setCreateError(result.error);
    }
    setCreating(false);
  }

  const createButton = (
    <button
      type="button"
      onClick={() => { setOpen(false); setDialogOpen(true); }}
      className="flex items-center gap-2 w-full px-2 py-2 text-sm font-medium text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 rounded-md cursor-pointer transition-colors"
    >
      <div className="flex items-center justify-center h-5 w-5 rounded bg-yellow-500/15 shrink-0">
        <Plus className="h-3.5 w-3.5" />
      </div>
      Create vendor
    </button>
  );

  return (
    <>
      <div className="space-y-4">
        {/* Hidden inputs for form submission */}
        <input type="hidden" name="vendorId" value={vendorId} />
        <input type="hidden" name="vendorType" value={vendorType} />
        <input type="hidden" name="vendorName" value={vendorName} />

        {/* Accounting guard: this form posts to a P&L expense account.
            A salary ADVANCE is an asset (Employee Advances, recoverable)
            and must go through the claims flow — booking it here would
            expense it immediately and lose the recovery tracking. */}
        {vendorType === "employee" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Paying an employee here books a <strong>business expense</strong>{" "}
            (reimbursement, fuel, airtime…). For <strong>salary advances</strong>{" "}
            use Employee Expenses → Advance instead — advances post to the
            recoverable Employee Advances account, not to P&L.
          </div>
        )}
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
                    <CommandEmpty>
                      <div className="py-2 text-center space-y-2">
                        <p className="text-sm text-muted-foreground">No vendor found.</p>
                        {createButton}
                      </div>
                    </CommandEmpty>
                    <CommandGroup heading="Registered Vendors">
                      {vendors.map((vendor) => (
                        <CommandItem
                          key={vendor._id}
                          value={`${vendor.name} ${vendor.taxPin || ""}`}
                          onSelect={() => handleSelect(vendor, "supplier")}
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
                    {employees.length > 0 && (
                      <CommandGroup heading="Employees">
                        {employees.map((emp) => (
                          <CommandItem
                            key={emp._id}
                            value={`${emp.name} employee`}
                            onSelect={() => handleSelect(emp, "employee")}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                vendorId === emp._id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{emp.name}</span>
                              <span className="text-xs text-muted-foreground">
                                Employee — advance / reimbursement
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem onSelect={handleManualEntry}>
                        <PenLine className="mr-2 h-4 w-4" />
                        Enter vendor manually
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                  <div className="border-t p-1">{createButton}</div>
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

        {/* Manual entry fields */}
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

      {/* Quick-create vendor dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setCreateError("");
        }}
      >
        <DialogContent className="sm:max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Plus className="h-4 w-4 text-yellow-500" />
              New Vendor
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateVendor} className="space-y-4">
            {createError && (
              <div className="flex items-center gap-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {createError}
              </div>
            )}

            <div className="space-y-2">
              <Label>
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                name="name"
                placeholder="Vendor name"
                required
                disabled={creating}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                name="phone"
                type="tel"
                placeholder="0712 345 678"
                disabled={creating}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                name="email"
                type="email"
                placeholder="vendor@example.com"
                disabled={creating}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                disabled={creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Vendor
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
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
// CATEGORY COMBOBOX - Searchable static list (controlled)
// ============================================
function CategoryCombobox({ categories = [], value, onValueChange, error }) {
  const [open, setOpen] = useState(false);

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
                      onValueChange(category.value);
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
// ASSET COMBOBOX - Optional link to a fixed asset
// ============================================
// Used for tagging fuel, maintenance, repairs, fueling, service costs, etc.
// to a specific vehicle/equipment so its running costs can be rolled up.
function AssetCombobox({ assets = [], value, onValueChange, error }) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const selected = assets.find((a) => a._id === value);
  const filtered = !searchValue
    ? assets
    : assets.filter(
        (a) =>
          a.assetNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
          a.name.toLowerCase().includes(searchValue.toLowerCase()) ||
          (a.registrationNumber || "")
            .toLowerCase()
            .includes(searchValue.toLowerCase())
      );

  return (
    <div className="space-y-1">
      <input type="hidden" name="assetId" value={value || ""} />
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
            {selected ? (
              <span className="flex items-center gap-2 truncate">
                <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  {selected.assetNumber}
                </span>
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              "No asset (optional)"
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by asset #, name, plate..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {assets.length === 0 ? (
                <CommandEmpty>
                  <div className="py-2 text-center text-sm text-muted-foreground">
                    No fixed assets registered yet.
                  </div>
                </CommandEmpty>
              ) : (
                <>
                  {value && (
                    <CommandGroup>
                      <CommandItem
                        value="__clear__"
                        onSelect={() => {
                          onValueChange("");
                          setOpen(false);
                        }}
                      >
                        <X className="mr-2 h-4 w-4" />
                        <span className="text-muted-foreground">
                          Clear selection
                        </span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                  {filtered.length === 0 ? (
                    <CommandEmpty>
                      <div className="py-2 text-center text-sm text-muted-foreground">
                        No matching assets.
                      </div>
                    </CommandEmpty>
                  ) : (
                    <CommandGroup heading="Active assets">
                      {filtered.slice(0, 15).map((a) => (
                        <CommandItem
                          key={a._id}
                          value={`${a.assetNumber} ${a.name}`}
                          onSelect={() => {
                            onValueChange(a._id);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === a._id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {a.name}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {a.assetNumber}
                              {a.registrationNumber
                                ? ` · ${a.registrationNumber}`
                                : ""}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
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

// Map expense account subType → expense category
const SUB_TYPE_TO_CATEGORY = {
  direct_cost: "materials",
  operating_expense: "maintenance",
  admin: "office_supplies",
  transport: "transport",
  transport_expense: "transport",
  travel_expense: "transport",
  fuel_expense: "transport",
  occupancy: "rent",
  communication: "telecommunications",
  professional: "legal_professional",
  insurance: "insurance",
  financial: "bank_charges",
  depreciation: "depreciation",
  employee_expense: "salaries",
  meals_expense: "meals_entertainment",
  utilities_expense: "utilities",
  other_expense: "other",
};

// ============================================
// FIELD ERROR HELPER
// ============================================
function FieldError({ errors, field }) {
  if (!errors?.[field]) return null;
  return <p className="text-sm text-destructive">{errors[field][0]}</p>;
}

// ============================================
// MAIN EXPENSE FORM
// ============================================
export default function ExpenseForm({
  expense = null,
  accounts = [],
  paymentAccounts = [],
  vendors = [],
  employees = [],
  categories = [],
  projects = [],
  assets = [],
}) {
  const isEditing = !!expense;

  // Form state
  const [amount, setAmount] = useState(expense?.amount || "");
  const [taxRate, setTaxRate] = useState(expense?.taxRate || 0);
  const [taxAmount, setTaxAmount] = useState(expense?.taxAmount || 0);
  const [withholdingTax, setWithholdingTax] = useState(expense?.withholdingTax || 0);
  const [paymentMethod, setPaymentMethod] = useState(expense?.paymentMethod || "unpaid");
  const [paidFrom, setPaidFrom] = useState(expense?.paidFrom || "");
  const [isReimbursable, setIsReimbursable] = useState(expense?.isReimbursable || false);
  // submitAndApprove removed — all expenses auto-post on save
  const [receipts, setReceipts] = useState(expense?.receipts || []);
  const [projectId, setProjectId] = useState(expense?.projectId || "");
  const [assetId, setAssetId] = useState(
    expense?.asset?.id?.toString?.() || expense?.asset?.id || ""
  );
  const [category, setCategory] = useState(expense?.category || "");
  const [expenseAccountId, setExpenseAccountId] = useState(expense?.accountId || "");
  const [allExpenseAccounts, setAllExpenseAccounts] = useState(accounts);
  const [allVendors, setAllVendors] = useState(vendors);

  // Auto-suggest category when expense account changes
  function handleExpenseAccountChange(id) {
    setExpenseAccountId(id);
    const account = allExpenseAccounts.find((a) => a._id === id);
    if (account?.subType) {
      const suggested = SUB_TYPE_TO_CATEGORY[account.subType];
      if (suggested) setCategory(suggested);
    }
  }

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

  // Action handler — single path: create + auto-post (or update + auto-post)
  const actionFn = isEditing
    ? updateExpense.bind(null, expense._id)
    : createExpense;

  const [state, formAction, isPending] = useActionState(actionFn, null);

  const errors = state?.errors;

  return (
    <form action={formAction} className="space-y-6">
      {/* Form-level errors */}
      {errors?._form && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          {errors._form.map((error, i) => (
            <p key={i} className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ))}
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
              <FieldError errors={errors} field="expenseDate" />
            </div>

            {/* Category - Searchable, auto-set from expense account */}
            <CategoryCombobox
              categories={categories}
              value={category}
              onValueChange={setCategory}
              error={errors?.category?.[0]}
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
              defaultValue={expense?.description || state?.values?.description || ""}
              required
              rows={2}
            />
            <FieldError errors={errors} field="description" />
          </div>

          {/* Expense Account - Searchable with quick add */}
          <div className="space-y-2">
            <Label>
              Expense Account <span className="text-destructive">*</span>
            </Label>
            <ExpenseAccountCombobox
              value={expenseAccountId}
              onValueChange={(id) => handleExpenseAccountChange(id)}
              accounts={allExpenseAccounts}
              onAccountCreated={(acc) =>
                setAllExpenseAccounts((prev) =>
                  [...prev, acc].sort((a, b) =>
                    a.accountCode.localeCompare(b.accountCode),
                  ),
                )
              }
              placeholder="Select expense account..."
            />
            <input type="hidden" name="accountId" value={expenseAccountId} />
            <FieldError errors={errors} field="accountId" />
          </div>
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
            vendors={allVendors}
            employees={employees}
            defaultValue={expense?.vendor}
            error={errors?.vendorName?.[0]}
            onVendorCreated={(party) =>
              setAllVendors((prev) => [...prev, party])
            }
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
                error={errors?.paidFrom?.[0]}
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
          {/* Project (Optional) */}
          {projects.length > 0 && (
            <div className="space-y-2">
              <Label>
                Project{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <input type="hidden" name="projectId" value={projectId} />
              <ProjectPicker
                value={projectId}
                onValueChange={setProjectId}
                projects={projects}
                placeholder="Link to a project..."
              />
              <p className="text-xs text-muted-foreground">
                Tag this expense to a project for cost tracking
              </p>
            </div>
          )}

          {/* Linked Asset (Optional) */}
          {assets.length > 0 && (
            <div className="space-y-2">
              <Label>
                Linked Asset{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <AssetCombobox
                assets={assets}
                value={assetId}
                onValueChange={setAssetId}
                error={errors?.assetId?.[0]}
              />
              <p className="text-xs text-muted-foreground">
                Tag this expense to a specific vehicle / equipment to track its
                fuel, maintenance, and running costs.
              </p>
            </div>
          )}

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
        <Button variant="outline" asChild>
          <Link href="/dashboard/expenses">Cancel</Link>
        </Button>

        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          {isEditing ? "Update & Post" : "Post Expense"}
        </Button>
      </div>
    </form>
  );
}
