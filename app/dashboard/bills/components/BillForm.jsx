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
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { createBill, updateBill } from "@/app/mongodb/actions/bill-actions";
import QuickCreatePartyDialog from "@/app/dashboard/invoices/components/QuickCreateCustomerDialog";
import ProjectPicker from "@/components/project-picker";

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
  const [supplierList, setSupplierList] = useState(initialSuppliers);

  const selectedSupplier = supplierList.find((s) => s._id === value);

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
                <p className="text-sm text-muted-foreground mb-2">No supplier found.</p>
                <QuickCreatePartyDialog
                  partyType="supplier"
                  onPartyCreated={(party) => {
                    setSupplierList((prev) => [party, ...prev]);
                    setValue(party._id);
                    setOpen(false);
                  }}
                >
                  <button type="button" className="inline-flex items-center text-sm text-yellow-500 hover:text-yellow-600 font-medium">
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
                onPartyCreated={(party) => {
                  setSupplierList((prev) => [party, ...prev]);
                  setValue(party._id);
                  setOpen(false);
                }}
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
// Groups accounts by purpose: Expense (services), Inventory (stock), Fixed Asset (acquisitions)
// ============================================
const FIXED_ASSET_SUBTYPES = new Set([
  "fixed_asset",
  "accumulated_depreciation",
]);

function accountBadge(account) {
  if (account.accountType === "expense") {
    return {
      label: "EXP",
      className:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    };
  }
  if (FIXED_ASSET_SUBTYPES.has(account.subType)) {
    return {
      label: "FA",
      className:
        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    };
  }
  return {
    label: "INV",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  };
}

function AccountCombobox({ accounts, index, defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");
  const [searchValue, setSearchValue] = useState("");

  const selectedAccount = accounts.find((a) => a._id === value);

  // Group accounts by purpose
  const expenseAccounts = accounts.filter((a) => a.accountType === "expense");
  const fixedAssetAccounts = accounts.filter(
    (a) => a.accountType === "asset" && FIXED_ASSET_SUBTYPES.has(a.subType)
  );
  const inventoryAssetAccounts = accounts.filter(
    (a) => a.accountType === "asset" && !FIXED_ASSET_SUBTYPES.has(a.subType)
  );

  // Filter by search
  const filterAccounts = (list) =>
    list.filter(
      (a) =>
        !searchValue ||
        a.accountName.toLowerCase().includes(searchValue.toLowerCase()) ||
        a.accountCode.toLowerCase().includes(searchValue.toLowerCase())
    );

  const filteredExpense = filterAccounts(expenseAccounts);
  const filteredAsset = filterAccounts(inventoryAssetAccounts);
  const filteredFixedAsset = filterAccounts(fixedAssetAccounts);
  const hasResults =
    filteredExpense.length > 0 ||
    filteredAsset.length > 0 ||
    filteredFixedAsset.length > 0;

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
              (() => {
                const badge = accountBadge(selectedAccount);
                return (
                  <span className="truncate flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                    {selectedAccount.accountCode} - {selectedAccount.accountName}
                  </span>
                );
              })()
            ) : (
              "Select account..."
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search accounts..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {!hasResults && (
                <CommandEmpty>
                  <div className="py-2 text-center">
                    <p className="text-sm text-muted-foreground mb-2">
                      No account found.
                    </p>
                    <Link
                      href="/dashboard/accounts/create"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                      onClick={() => setOpen(false)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create new account
                    </Link>
                  </div>
                </CommandEmpty>
              )}

              {/* Expense Accounts - for services, utilities, consumables */}
              {filteredExpense.length > 0 && (
                <CommandGroup heading="Expense Accounts (Services, Costs)">
                  {filteredExpense.slice(0, 8).map((account) => (
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
                      <div className="flex flex-col flex-1">
                        <span className="font-medium">
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">
                            {account.accountCode}
                          </span>
                          {account.accountName}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                        EXP
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Inventory Accounts - for stock/goods purchases */}
              {filteredAsset.length > 0 && (
                <CommandGroup heading="Inventory Accounts (Stock Purchases)">
                  {filteredAsset.slice(0, 8).map((account) => (
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
                      <div className="flex flex-col flex-1">
                        <span className="font-medium">
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">
                            {account.accountCode}
                          </span>
                          {account.accountName}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        INV
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Fixed Asset Accounts - for asset acquisitions */}
              {filteredFixedAsset.length > 0 && (
                <CommandGroup heading="Fixed Asset Accounts (Acquisitions)">
                  {filteredFixedAsset.slice(0, 8).map((account) => (
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
                      <div className="flex flex-col flex-1">
                        <span className="font-medium">
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">
                            {account.accountCode}
                          </span>
                          {account.accountName}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        FA
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Quick create link at bottom */}
              {hasResults && (
                <div className="border-t px-2 py-2">
                  <Link
                    href="/dashboard/accounts/create"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                    onClick={() => setOpen(false)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create new account
                  </Link>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================
// ASSET COMBOBOX COMPONENT
// ============================================
// Optional per-line link to a fixed asset (e.g., tag a vehicle service
// bill to the specific Hilux it was for). Hidden input emits assetId.
function AssetCombobox({ assets, index, defaultValue, error }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue || "");
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
      <input type="hidden" name={`lines[${index}].assetId`} value={value} />
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
            {selected ? (
              <span className="truncate flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {selected.assetNumber}
                </span>
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              "No asset (optional)"
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0" align="start">
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
                    No assets registered yet.
                  </div>
                </CommandEmpty>
              ) : (
                <>
                  {value && (
                    <CommandGroup>
                      <CommandItem
                        value="__clear__"
                        onSelect={() => {
                          setValue("");
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
                  {filtered.length === 0 && (
                    <CommandEmpty>
                      <div className="py-2 text-center text-sm text-muted-foreground">
                        No matching assets.
                      </div>
                    </CommandEmpty>
                  )}
                  {filtered.length > 0 && (
                    <CommandGroup heading="Active Assets">
                      {filtered.slice(0, 12).map((a) => (
                        <CommandItem
                          key={a._id}
                          value={`${a.assetNumber} ${a.name}`}
                          onSelect={() => {
                            setValue(a._id);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === a._id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="font-medium truncate">
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
  assets,
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

        {/* Account Selection — defaults to Inventory when a stock
            product is picked on the line. Re-mounts the combobox via
            `key` so the new defaultValue actually takes effect (the
            combobox stores its own internal state). */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            GL Account <span className="text-destructive">*</span>
          </Label>
          <AccountCombobox
            key={
              line?.accountId
                ? `acct-${line.accountId}`
                : line?.account?.id
                ? `acct-${line.account.id}`
                : `acct-empty-${index}`
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
            Auto-picks <strong>Inventory</strong> for stock products.
            Override to Expense (services / consumables) or Fixed Asset
            (capital purchases) as needed.
          </p>
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

      {/* Optional: link this line to a fixed asset (vehicle service, repairs, fuel, etc.) */}
      {assets.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Linked Asset{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <AssetCombobox
            assets={assets}
            index={index}
            defaultValue={line?.asset?.id?.toString() || ""}
            error={lineErrors[`lines.${index}.assetId`]}
          />
          <p className="text-xs text-muted-foreground">
            Tag this line to a specific asset to track its maintenance & running
            costs.
          </p>
          {lineErrors[`lines.${index}.assetId`] && (
            <p className="text-xs text-destructive">
              {lineErrors[`lines.${index}.assetId`]}
            </p>
          )}
        </div>
      )}
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
  assets = [],
  projects = [],
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
  // Project State (optional)
  // ----------------------------------------
  const [projectId, setProjectId] = useState(bill?.projectId || "");

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

  // Find the tenant's Inventory system account once — used to default
  // the bill line's GL account when the user picks a stock product.
  // Industry-standard pattern: SAP/NetSuite/Xero/Odoo all auto-derive
  // the inventory posting account from the product on every line.
  const inventoryAccount = accounts.find(
    (a) => a.systemAccount === "inventory",
  );

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

    // Auto-default the GL account to Inventory when the user hasn't
    // already picked one. We lift this into line state so the
    // AccountCombobox can re-mount with the new defaultValue (the
    // combobox stores its own state internally — controlled via key).
    if (inventoryAccount) {
      setLines((prev) =>
        prev.map((line, i) =>
          i === index && !line.accountId && !line.account?.id
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

          {/* Title & Reference */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-sm font-medium">
                Title / Subject
              </Label>
              <Input
                id="title"
                name="title"
                defaultValue={bill?.title || ""}
                placeholder="e.g. Office Supplies - January"
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference" className="text-sm font-medium">
                Reference
              </Label>
              <Input
                id="reference"
                name="reference"
                defaultValue={bill?.reference || ""}
                placeholder="Your internal reference"
                className="h-9"
              />
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
                assets={assets}
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

        <div className="p-4 sm:p-6 space-y-4">
          {/* Project (Optional) */}
          {projects.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
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
                Tag this bill to a project for cost tracking
              </p>
            </div>
          )}

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
