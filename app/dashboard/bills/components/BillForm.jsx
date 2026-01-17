// app/(dashboard)/bills/components/BillForm.jsx
"use client";

// ============================================
// NEXT.JS 16 FORM STANDARD
// ============================================
// ✅ useActionState for form state management
// ✅ Uncontrolled inputs with name props
// ✅ FormData sent directly to server action
// ✅ Field-level error display
// ✅ General error display at top
// ✅ Server action returns { success, error, fieldErrors }
// ✅ Consistent theming with design system
// ============================================

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Trash2,
  Building2,
  Calendar,
  FileText,
  Package,
  Calculator,
  AlertCircle,
  Loader2,
  Save,
  X,
  Receipt,
  ChevronDown,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { createBill, updateBill } from "@/app/mongodb/actions/bill-actions";

// ============================================
// INITIAL STATE
// ============================================
const initialState = {
  success: false,
  error: null,
  fieldErrors: null,
  data: null,
};

// ============================================
// SUPPLIER COMBOBOX COMPONENT
// ============================================
function SupplierCombobox({ suppliers, defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");

  const selectedSupplier = suppliers.find((s) => s._id === value);

  return (
    <div className="space-y-2">
      <input type="hidden" name="supplierId" value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            {selectedSupplier ? (
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {selectedSupplier.name}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Select supplier...
              </span>
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput placeholder="Search suppliers..." />
            <CommandList>
              <CommandEmpty>No supplier found.</CommandEmpty>
              <CommandGroup>
                {suppliers.map((supplier) => (
                  <CommandItem
                    key={supplier._id}
                    value={`${supplier.name} ${supplier.taxPin || ""}`}
                    onSelect={() => {
                      setValue(supplier._id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === supplier._id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{supplier.name}</span>
                      {supplier.taxPin && (
                        <span className="text-xs text-muted-foreground">
                          PIN: {supplier.taxPin}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================
// PRODUCT/SERVICE COMBOBOX COMPONENT
// Allows selecting inventory products OR typing custom service/item names
// ============================================
function ProductCombobox({ products, index, defaultValue, defaultCustomName, onProductChange }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(defaultValue || "");
  const [customName, setCustomName] = useState(defaultCustomName || "");
  const [searchValue, setSearchValue] = useState("");

  const selectedProduct = products.find((p) => p._id === productId);
  const isCustom = !productId && customName;

  const handleSelectProduct = (product) => {
    setProductId(product._id);
    setCustomName("");
    setOpen(false);
    onProductChange?.(index, product._id);
  };

  const handleUseCustom = () => {
    if (searchValue.trim()) {
      setProductId("");
      setCustomName(searchValue.trim());
      setOpen(false);
    }
  };

  const displayValue = selectedProduct
    ? `${selectedProduct.sku} - ${selectedProduct.name}`
    : customName
    ? customName
    : null;

  return (
    <div className="space-y-1">
      {/* Hidden inputs for form submission */}
      <input type="hidden" name={`lines[${index}].productId`} value={productId} />
      <input type="hidden" name={`lines[${index}].customProductName`} value={customName} />

      <Popover
        open={open}
        onOpenChange={(isOpen) => {
          // Auto-capture typed value when closing IF no matching products found
          if (!isOpen && searchValue.trim() && !productId) {
            const hasMatchingProducts = products.some(
              (p) =>
                p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                p.sku.toLowerCase().includes(searchValue.toLowerCase())
            );
            // Only auto-capture if no matching inventory items exist
            if (!hasMatchingProducts) {
              setCustomName(searchValue.trim());
              setSearchValue("");
            }
          }
          setOpen(isOpen);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal text-sm h-9",
              !displayValue && "text-muted-foreground"
            )}
          >
            {displayValue ? (
              <span className="truncate flex items-center gap-2">
                {isCustom && <FileText className="h-3 w-3 text-muted-foreground" />}
                {selectedProduct && <Package className="h-3 w-3 text-muted-foreground" />}
                {displayValue}
              </span>
            ) : (
              "Select or type item..."
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search products or type service name..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {/* Option to use custom typed value */}
              {searchValue.trim() && (
                <CommandGroup heading="Use as custom item">
                  <CommandItem onSelect={handleUseCustom}>
                    <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="font-medium">&quot;{searchValue}&quot;</span>
                      <span className="text-xs text-muted-foreground">
                        Use as service/expense (not inventory)
                      </span>
                    </div>
                  </CommandItem>
                </CommandGroup>
              )}

              {/* Clear selection option */}
              {(productId || customName) && (
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setProductId("");
                      setCustomName("");
                      setOpen(false);
                    }}
                  >
                    <X className="mr-2 h-4 w-4 text-muted-foreground" />
                    Clear selection
                  </CommandItem>
                </CommandGroup>
              )}

              {/* Inventory products */}
              <CommandGroup heading="Inventory Products">
                {products
                  .filter(
                    (p) =>
                      !searchValue ||
                      p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                      p.sku.toLowerCase().includes(searchValue.toLowerCase())
                  )
                  .slice(0, 10)
                  .map((product) => (
                    <CommandItem
                      key={product._id}
                      value={product._id}
                      onSelect={() => handleSelectProduct(product)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          productId === product._id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {product.sku}
                          </span>
                          {product.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Cost: {product.costPrice?.toLocaleString() || 0} • {product.unit}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                {products.filter(
                  (p) =>
                    !searchValue ||
                    p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                    p.sku.toLowerCase().includes(searchValue.toLowerCase())
                ).length === 0 && (
                  <CommandEmpty>No products found. Type to add custom item.</CommandEmpty>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================
// ACCOUNT COMBOBOX COMPONENT
// ============================================
function AccountCombobox({ accounts, index, defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");

  const selectedAccount = accounts.find((a) => a._id === value);

  return (
    <div className="space-y-1">
      <input type="hidden" name={`lines[${index}].accountId`} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal text-sm h-9",
              !value && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            {selectedAccount ? (
              <span className="truncate">
                {selectedAccount.accountCode} - {selectedAccount.accountName}
              </span>
            ) : (
              "Select account..."
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
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
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {account.accountCode} - {account.accountName}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {account.accountType}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================
// LINE ITEM COMPONENT
// ============================================
function LineItem({
  index,
  line,
  accounts,
  products,
  errors,
  onRemove,
  onProductChange,
  canRemove,
}) {
  const lineErrors = errors || {};

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4 shadow-sm">
      {/* Line Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Line {index + 1}
        </span>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Product & Account Selection */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Product/Service Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Product / Service{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <ProductCombobox
            products={products}
            index={index}
            defaultValue={line?.product?.id?.toString() || ""}
            defaultCustomName={line?.customProductName || ""}
            onProductChange={onProductChange}
          />
          <p className="text-xs text-muted-foreground">
            Select inventory item or type service/expense name
          </p>
        </div>

        {/* Account Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Expense Account <span className="text-destructive">*</span>
          </Label>
          <AccountCombobox
            accounts={accounts}
            index={index}
            defaultValue={line?.account?.id?.toString() || ""}
            error={lineErrors[`lines.${index}.accountId`]}
          />
          {lineErrors[`lines.${index}.accountId`] && (
            <p className="text-xs text-destructive">
              {lineErrors[`lines.${index}.accountId`]}
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label
          htmlFor={`lines[${index}].description`}
          className="text-sm font-medium"
        >
          Description <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`lines[${index}].description`}
          name={`lines[${index}].description`}
          defaultValue={line?.description || ""}
          placeholder="Enter item description..."
          className={cn(
            "h-9",
            lineErrors[`lines.${index}.description`] && "border-destructive"
          )}
          required
        />
        {lineErrors[`lines.${index}.description`] && (
          <p className="text-xs text-destructive">
            {lineErrors[`lines.${index}.description`]}
          </p>
        )}
      </div>

      {/* Quantity, Unit, Price, VAT - Responsive Grid */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="space-y-2">
          <Label
            htmlFor={`lines[${index}].quantity`}
            className="text-sm font-medium"
          >
            Qty <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`lines[${index}].quantity`}
            name={`lines[${index}].quantity`}
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={line?.quantity || 1}
            className={cn(
              "h-9",
              lineErrors[`lines.${index}.quantity`] && "border-destructive"
            )}
            required
          />
          {lineErrors[`lines.${index}.quantity`] && (
            <p className="text-xs text-destructive">
              {lineErrors[`lines.${index}.quantity`]}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor={`lines[${index}].unit`}
            className="text-sm font-medium"
          >
            Unit
          </Label>
          <Input
            id={`lines[${index}].unit`}
            name={`lines[${index}].unit`}
            defaultValue={line?.unit || "pcs"}
            placeholder="pcs"
            className="h-9"
          />
        </div>

        <div className="space-y-2">
          <Label
            htmlFor={`lines[${index}].unitPrice`}
            className="text-sm font-medium"
          >
            Unit Price <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`lines[${index}].unitPrice`}
            name={`lines[${index}].unitPrice`}
            type="number"
            step="0.01"
            min="0"
            defaultValue={line?.unitPrice || 0}
            className={cn(
              "h-9",
              lineErrors[`lines.${index}.unitPrice`] && "border-destructive"
            )}
            required
          />
          {lineErrors[`lines.${index}.unitPrice`] && (
            <p className="text-xs text-destructive">
              {lineErrors[`lines.${index}.unitPrice`]}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor={`lines[${index}].vatRate`}
            className="text-sm font-medium"
          >
            VAT %
          </Label>
          <Select
            name={`lines[${index}].vatRate`}
            defaultValue={String(line?.vat?.rate ?? 16)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0% (Exempt)</SelectItem>
              <SelectItem value="8">8% (Reduced)</SelectItem>
              <SelectItem value="16">16% (Standard)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN FORM COMPONENT
// ============================================
export default function BillForm({
  bill = null,
  suppliers = [],
  accounts = [],
  products = [],
}) {
  const formRef = useRef(null);
  const isEdit = !!bill;

  // ----------------------------------------
  // Form State with useActionState
  // ----------------------------------------
  const action = isEdit ? updateBill.bind(null, bill._id) : createBill;
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Normalize errors - handle both 'errors' and 'fieldErrors' from server
  const errors = state.fieldErrors || state.errors || {};

  // ----------------------------------------
  // Lines State (dynamic array)
  // ----------------------------------------
  const [lines, setLines] = useState(() => {
    if (bill?.lines?.length > 0) {
      return bill.lines.map((line, i) => ({ ...line, key: i }));
    }
    return [{ key: 0 }];
  });

  const [keyCounter, setKeyCounter] = useState(bill?.lines?.length || 1);

  // ----------------------------------------
  // WHT State
  // ----------------------------------------
  const [whtApplicable, setWhtApplicable] = useState(
    bill?.whtApplicable || false
  );

  // ----------------------------------------
  // Line Management
  // ----------------------------------------
  const addLine = () => {
    setLines((prev) => [...prev, { key: keyCounter }]);
    setKeyCounter((prev) => prev + 1);
  };

  const removeLine = (index) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProductChange = (index, productId) => {
    if (!productId || productId === "none") return;

    const product = products.find((p) => p._id === productId);
    if (!product) return;

    const form = formRef.current;
    if (form) {
      const descInput = form.querySelector(
        `[name="lines[${index}].description"]`
      );
      const priceInput = form.querySelector(
        `[name="lines[${index}].unitPrice"]`
      );
      const unitInput = form.querySelector(`[name="lines[${index}].unit"]`);

      if (descInput && !descInput.value) {
        descInput.value = product.name;
      }
      if (priceInput && (!priceInput.value || priceInput.value === "0")) {
        priceInput.value = product.costPrice || product.costing?.costPrice || 0;
      }
      if (unitInput && (!unitInput.value || unitInput.value === "pcs")) {
        unitInput.value = product.unit || "pcs";
      }
    }
  };

  // ----------------------------------------
  // RENDER
  // ----------------------------------------
  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      {/* General Error Alert */}
      {state.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Error creating bill</p>
            <p className="text-sm text-destructive/80 mt-1">{state.error}</p>
          </div>
        </div>
      )}

      {/* SECTION: Supplier & Dates */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 sm:px-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Building2 className="h-5 w-5 text-primary" />
            Supplier Details
          </h2>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Supplier */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <Label className="text-sm font-medium">
                Supplier <span className="text-destructive">*</span>
              </Label>
              <SupplierCombobox
                suppliers={suppliers}
                defaultValue={bill?.supplier?.partyId?.toString() || ""}
                error={errors?.supplierId}
              />
              {errors?.supplierId && (
                <p className="text-xs text-destructive">{errors.supplierId}</p>
              )}
            </div>

            {/* Supplier Invoice Number */}
            <div className="space-y-2">
              <Label
                htmlFor="supplierInvoiceNumber"
                className="text-sm font-medium"
              >
                Supplier Invoice #
              </Label>
              <Input
                id="supplierInvoiceNumber"
                name="supplierInvoiceNumber"
                defaultValue={bill?.supplierInvoiceNumber || ""}
                placeholder="e.g., INV-2025-001"
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Reference number from supplier&apos;s invoice
              </p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Bill Date */}
            <div className="space-y-2">
              <Label htmlFor="billDate" className="text-sm font-medium">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Bill Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="billDate"
                name="billDate"
                type="date"
                defaultValue={
                  bill?.billDate
                    ? new Date(bill.billDate).toISOString().split("T")[0]
                    : new Date().toISOString().split("T")[0]
                }
                className={cn("h-9", errors?.billDate && "border-destructive")}
                required
              />
              {errors?.billDate && (
                <p className="text-xs text-destructive">{errors.billDate}</p>
              )}
            </div>

            {/* Due Date */}
            <div className="space-y-2">
              <Label htmlFor="dueDate" className="text-sm font-medium">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Due Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={
                  bill?.dueDate
                    ? new Date(bill.dueDate).toISOString().split("T")[0]
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                        .toISOString()
                        .split("T")[0]
                }
                className={cn("h-9", errors?.dueDate && "border-destructive")}
                required
              />
              {errors?.dueDate && (
                <p className="text-xs text-destructive">{errors.dueDate}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: Line Items */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 sm:px-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Package className="h-5 w-5 text-primary" />
            Line Items
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
            className="h-8"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Line
          </Button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {errors?.lines && typeof errors.lines === "string" && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {errors.lines}
            </div>
          )}

          <div className="space-y-4">
            {lines.map((line, index) => (
              <LineItem
                key={line.key}
                index={index}
                line={line}
                accounts={accounts}
                products={products}
                errors={errors}
                onRemove={() => removeLine(index)}
                onProductChange={handleProductChange}
                canRemove={lines.length > 1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: Tax Settings */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 sm:px-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Calculator className="h-5 w-5 text-primary" />
            Tax Settings
          </h2>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="space-y-0.5">
              <Label htmlFor="whtApplicable" className="text-sm font-medium">
                Withholding Tax (WHT)
              </Label>
              <p className="text-xs text-muted-foreground">
                Apply WHT deduction when paying this bill
              </p>
            </div>
            <input
              type="hidden"
              name="whtApplicable"
              value={whtApplicable ? "true" : "false"}
            />
            <Switch
              id="whtApplicable"
              checked={whtApplicable}
              onCheckedChange={setWhtApplicable}
            />
          </div>

          {whtApplicable && (
            <div className="space-y-2 pl-4 border-l-2 border-primary/30">
              <Label htmlFor="whtRate" className="text-sm font-medium">
                WHT Rate
              </Label>
              <Select name="whtRate" defaultValue={String(bill?.whtRate || 3)}>
                <SelectTrigger className="w-full sm:w-48 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3% - Contractors</SelectItem>
                  <SelectItem value="5">5% - Professional services</SelectItem>
                  <SelectItem value="10">10% - Royalties</SelectItem>
                  <SelectItem value="15">15% - Interest</SelectItem>
                  <SelectItem value="20">20% - Dividends</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Kenya standard withholding tax rates
              </p>
            </div>
          )}

          {!whtApplicable && <input type="hidden" name="whtRate" value="0" />}
        </div>
      </section>

      {/* SECTION: Notes */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 sm:px-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileText className="h-5 w-5 text-primary" />
            Additional Information
          </h2>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description / Memo
              </Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={bill?.description || ""}
                placeholder="Purpose of this bill..."
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="internalNotes" className="text-sm font-medium">
                Internal Notes
              </Label>
              <Textarea
                id="internalNotes"
                name="internalNotes"
                defaultValue={bill?.internalNotes || ""}
                placeholder="Notes for internal use only..."
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Not visible to suppliers
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ACTIONS - Sticky on mobile */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 max-w-4xl mx-auto">
          <Button type="button" variant="outline" asChild disabled={isPending}>
            <Link href="/dashboard/bills">
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={isPending} className="min-w-[140px]">
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isEdit ? "Updating..." : "Creating..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {isEdit ? "Update Bill" : "Create Bill"}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
