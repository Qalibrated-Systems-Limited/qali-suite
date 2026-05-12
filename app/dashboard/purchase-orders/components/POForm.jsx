"use client";

// ============================================
// NEXT.JS 16 FORM STANDARD
// ============================================
// - useActionState for form state management
// - Uncontrolled inputs with name props
// - FormData sent directly to server action
// - Field-level error display
// - Server action returns { success, error, fieldErrors }
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
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  createPurchaseOrder,
  updatePurchaseOrder,
} from "@/app/mongodb/actions/purchase-order-actions";
import QuickCreatePartyDialog from "@/app/dashboard/invoices/components/QuickCreateCustomerDialog";

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
function SupplierCombobox({ suppliers: initialSuppliers, defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");
  // Local copy so we can append a freshly-created supplier without a
  // page round-trip.
  const [supplierList, setSupplierList] = useState(initialSuppliers || []);

  const selectedSupplier = supplierList.find((s) => s._id === value);

  const handlePartyCreated = (party) => {
    setSupplierList((prev) => [party, ...prev]);
    setValue(party._id);
    setOpen(false);
  };

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
              <CommandEmpty className="py-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  No supplier found.
                </p>
                <QuickCreatePartyDialog
                  partyType="supplier"
                  onPartyCreated={handlePartyCreated}
                >
                  <button
                    type="button"
                    className="inline-flex items-center text-sm text-yellow-500 hover:text-yellow-600 font-medium"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Create new supplier
                  </button>
                </QuickCreatePartyDialog>
              </CommandEmpty>
              <CommandGroup>
                {supplierList.map((supplier) => (
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

            {/* Persistent "Create new supplier" footer — always visible
                outside the CommandList so cmdk's keyboard/click handling
                doesn't fight with the Dialog trigger. */}
            <CommandSeparator />
            <div className="p-1">
              <QuickCreatePartyDialog
                partyType="supplier"
                onPartyCreated={handlePartyCreated}
              >
                <button
                  type="button"
                  className="w-full inline-flex items-center rounded-sm px-2 py-1.5 text-sm font-medium text-yellow-600 dark:text-yellow-500 hover:bg-accent transition-colors"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create new supplier
                </button>
              </QuickCreatePartyDialog>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================
// PRODUCT COMBOBOX COMPONENT
// ============================================
function ProductCombobox({ products, index, defaultValue, onProductChange }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(defaultValue || "");
  const [searchValue, setSearchValue] = useState("");

  const selectedProduct = products.find((p) => p._id === productId);

  const handleSelectProduct = (product) => {
    setProductId(product._id);
    setOpen(false);
    onProductChange?.(index, product._id);
  };

  const displayValue = selectedProduct
    ? `${selectedProduct.SKU} - ${selectedProduct.name}`
    : null;

  return (
    <div className="space-y-1">
      <input type="hidden" name={`lines[${index}].productId`} value={productId} />

      <Popover open={open} onOpenChange={setOpen}>
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
                <Package className="h-3 w-3 text-muted-foreground" />
                {displayValue}
              </span>
            ) : (
              "Select product..."
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search products..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {/* Clear selection option */}
              {productId && (
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setProductId("");
                      setOpen(false);
                    }}
                  >
                    <X className="mr-2 h-4 w-4 text-muted-foreground" />
                    Clear selection
                  </CommandItem>
                </CommandGroup>
              )}

              {/* Products list */}
              <CommandGroup heading="Products">
                {products
                  .filter(
                    (p) =>
                      !searchValue ||
                      p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                      p.SKU.toLowerCase().includes(searchValue.toLowerCase())
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
                            {product.SKU}
                          </span>
                          {product.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Cost: {product.costing?.costPrice?.toLocaleString() || 0} | Stock: {product.inventory?.quantityOnHand ?? 0}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                {products.filter(
                  (p) =>
                    !searchValue ||
                    p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                    p.SKU.toLowerCase().includes(searchValue.toLowerCase())
                ).length === 0 && (
                  <CommandEmpty>No products found.</CommandEmpty>
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
                {selectedAccount.code} - {selectedAccount.name}
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
                    value={`${account.code} ${account.name}`}
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
                        {account.code} - {account.name}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {account.type}
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
          <Package className="h-4 w-4" />
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
        {/* Product Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Product <span className="text-destructive">*</span>
          </Label>
          <ProductCombobox
            products={products}
            index={index}
            defaultValue={line?.product?.id?.toString() || ""}
            onProductChange={onProductChange}
          />
          {lineErrors[`lines.${index}.productId`] && (
            <p className="text-xs text-destructive">
              {lineErrors[`lines.${index}.productId`]}
            </p>
          )}
        </div>

        {/* Account Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            GL Account
          </Label>
          <AccountCombobox
            // Re-mount when the parent's auto-default fires so the new
            // defaultValue actually applies (AccountCombobox is built
            // around defaultValue not value).
            key={
              line?.accountId
                ? `acct-${line.accountId}`
                : `acct-empty-${line.key}`
            }
            accounts={accounts}
            index={index}
            defaultValue={
              line?.accountId ||
              line?.account?.id?.toString() ||
              ""
            }
            error={lineErrors[`lines.${index}.accountId`]}
          />
          <p className="text-xs text-muted-foreground">
            For inventory items, pick the <strong>Inventory</strong> account
            (asset). For services / consumables, pick the relevant expense
            account.
          </p>
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

      {/* Quantity, Unit, Price, VAT */}
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
export default function POForm({
  purchaseOrder = null,
  suppliers = [],
  accounts = [],
  products = [],
}) {
  const formRef = useRef(null);
  const isEdit = !!purchaseOrder;

  // ----------------------------------------
  // Form State with useActionState
  // ----------------------------------------
  const action = isEdit
    ? updatePurchaseOrder.bind(null, purchaseOrder._id)
    : createPurchaseOrder;
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Normalize errors
  const errors = state.fieldErrors || state.errors || {};

  // ----------------------------------------
  // Lines State (dynamic array)
  // ----------------------------------------
  const [lines, setLines] = useState(() => {
    if (purchaseOrder?.lines?.length > 0) {
      return purchaseOrder.lines.map((line, i) => ({ ...line, key: i }));
    }
    return [{ key: 0 }];
  });

  const [keyCounter, setKeyCounter] = useState(purchaseOrder?.lines?.length || 1);

  // ----------------------------------------
  // WHT State
  // ----------------------------------------
  const [whtApplicable, setWhtApplicable] = useState(
    purchaseOrder?.whtApplicable || false
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

  // When a line gets a product picked, default the GL account to
  // Inventory (the asset account) — that's the textbook answer for
  // stock-bearing purchases. The user can still override if they want
  // to capitalise as a fixed asset, but they no longer have to hunt
  // for the right account by hand.
  const inventoryAccount = accounts.find(
    (a) => a.systemAccount === "inventory",
  );

  const handleProductChange = (index, productId) => {
    if (!productId) return;

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
        priceInput.value = product.costPrice || 0;
      }
      if (unitInput && (!unitInput.value || unitInput.value === "pcs")) {
        unitInput.value = product.unit || "pcs";
      }
    }

    // Auto-default the account to Inventory if the user hasn't already
    // picked one. We use lifted line state so the AccountCombobox can
    // re-mount with the new defaultValue (controlled via its `key`).
    if (inventoryAccount) {
      setLines((prev) =>
        prev.map((line, i) =>
          i === index && !line.accountId
            ? { ...line, accountId: inventoryAccount._id }
            : line,
        ),
      );
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
            <p className="font-medium text-destructive">
              Error {isEdit ? "updating" : "creating"} purchase order
            </p>
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
                defaultValue={purchaseOrder?.supplier?.partyId?.toString() || ""}
                error={errors?.supplierId}
              />
              {errors?.supplierId && (
                <p className="text-xs text-destructive">{errors.supplierId}</p>
              )}
            </div>

            {/* Reference Number */}
            <div className="space-y-2">
              <Label htmlFor="reference" className="text-sm font-medium">
                Reference #
              </Label>
              <Input
                id="reference"
                name="reference"
                defaultValue={purchaseOrder?.reference || ""}
                placeholder="e.g., RFQ-2025-001"
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Optional reference from request for quote
              </p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            {/* PO Date */}
            <div className="space-y-2">
              <Label htmlFor="poDate" className="text-sm font-medium">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                PO Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="poDate"
                name="poDate"
                type="date"
                defaultValue={
                  purchaseOrder?.poDate
                    ? new Date(purchaseOrder.poDate).toISOString().split("T")[0]
                    : new Date().toISOString().split("T")[0]
                }
                className={cn("h-9", errors?.poDate && "border-destructive")}
                required
              />
              {errors?.poDate && (
                <p className="text-xs text-destructive">{errors.poDate}</p>
              )}
            </div>

            {/* Expected Delivery Date */}
            <div className="space-y-2">
              <Label htmlFor="expectedDeliveryDate" className="text-sm font-medium">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Expected Delivery
              </Label>
              <Input
                id="expectedDeliveryDate"
                name="expectedDeliveryDate"
                type="date"
                defaultValue={
                  purchaseOrder?.expectedDeliveryDate
                    ? new Date(purchaseOrder.expectedDeliveryDate).toISOString().split("T")[0]
                    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                        .toISOString()
                        .split("T")[0]
                }
                className="h-9"
              />
            </div>

            {/* Valid Until */}
            <div className="space-y-2">
              <Label htmlFor="validUntil" className="text-sm font-medium">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Valid Until
              </Label>
              <Input
                id="validUntil"
                name="validUntil"
                type="date"
                defaultValue={
                  purchaseOrder?.validUntil
                    ? new Date(purchaseOrder.validUntil).toISOString().split("T")[0]
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                        .toISOString()
                        .split("T")[0]
                }
                className="h-9"
              />
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
                Apply WHT deduction when paying bills from this PO
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
              <Select
                name="whtRate"
                defaultValue={String(purchaseOrder?.whtRate || 3)}
              >
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
            </div>
          )}

          {!whtApplicable && <input type="hidden" name="whtRate" value="0" />}
        </div>
      </section>

      {/* SECTION: Delivery & Notes */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 sm:px-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileText className="h-5 w-5 text-primary" />
            Additional Information
          </h2>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {/* Delivery Address */}
          <div className="space-y-2">
            <Label htmlFor="deliveryAddress" className="text-sm font-medium">
              Delivery Address
            </Label>
            <Textarea
              id="deliveryAddress"
              name="deliveryAddress"
              defaultValue={purchaseOrder?.deliveryAddress || ""}
              placeholder="Enter delivery address..."
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm font-medium">
                Notes (for supplier)
              </Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={purchaseOrder?.notes || ""}
                placeholder="Notes visible to supplier..."
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
                defaultValue={purchaseOrder?.internalNotes || ""}
                placeholder="Notes for internal use only..."
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Not visible to suppliers
              </p>
            </div>
          </div>

          {/* Terms */}
          <div className="space-y-2">
            <Label htmlFor="terms" className="text-sm font-medium">
              Terms & Conditions
            </Label>
            <Textarea
              id="terms"
              name="terms"
              defaultValue={purchaseOrder?.terms || ""}
              placeholder="Enter terms and conditions..."
              rows={3}
              className="resize-none"
            />
          </div>
        </div>
      </section>

      {/* ACTIONS - Sticky on mobile */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 max-w-4xl mx-auto">
          <Button type="button" variant="outline" asChild disabled={isPending}>
            <Link href="/dashboard/purchase-orders">
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
                {isEdit ? "Update PO" : "Create PO"}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
