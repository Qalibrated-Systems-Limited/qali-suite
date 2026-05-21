"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CategoryCombobox } from "./CategoryCombobox";
import { cn } from "@/lib/utils";

/**
 * Product unit options
 */
export const UNIT_OPTIONS = [
  { value: "piece", label: "Piece (pc)" },
  { value: "set", label: "Set" },
  { value: "unit", label: "Unit" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "t", label: "Tonne (t)" },
  { value: "g", label: "Gram (g)" },
  { value: "m", label: "Meter (m)" },
  { value: "mm", label: "Millimeter (mm)" },
  { value: "l", label: "Liter (L)" },
  { value: "box", label: "Box" },
  { value: "pack", label: "Pack" },
  { value: "roll", label: "Roll" },
  { value: "hour", label: "Hour" },
];

/**
 * Costing method options. Values MUST match the validator enum at
 * stock-actions.js (`["average", "weighted_average", "fifo", "lifo",
 * "specific"]`) — earlier "standard" was sent but rejected by validation.
 */
export const COSTING_METHODS = [
  { value: "weighted_average", label: "Weighted Average" },
  { value: "average", label: "Moving Average" },
  { value: "fifo", label: "FIFO (First In, First Out)" },
  { value: "lifo", label: "LIFO (Last In, First Out)" },
  { value: "specific", label: "Specific Identification" },
];

/**
 * Product type options. Values MUST match the validator enum
 * (`["product", "service", "kit"]`); labels are the UI-friendly text.
 * Earlier the UI sent "inventory" / "non-inventory" which always failed
 * server-side validation.
 */
export const PRODUCT_TYPES = [
  { value: "product", label: "Inventory Item" },
  { value: "service", label: "Service" },
  { value: "kit", label: "Kit / Bundle" },
];

/**
 * Tax rate options (Kenya)
 */
export const TAX_RATES = [
  { value: "16", label: "VAT 16% (Standard)" },
  { value: "8", label: "VAT 8% (Reduced)" },
  { value: "0", label: "VAT Exempt (0%)" },
];

/**
 * Field component with label and error handling
 */
export function FormField({
  label,
  name,
  error,
  required = false,
  hint,
  children,
  className,
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ============================================
// BASIC INFO FIELDS
// ============================================
// ✅ CORRECT - calls onChange with value
export function ProductNameField({ value, onChange, error }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="name">Product Name *</Label>
      <Input
        id="name"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)} // ← MUST call onChange
        placeholder="Enter product name"
        className={error ? "border-destructive" : ""}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ProductSKUField({
  value, // ← Use value from parent
  onChange, // ← Use onChange from parent
  error,
  disabled,
  autoGenerate = true,
}) {
  const generateSKU = () => {
    const prefix = "SKU";
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    onChange(`${prefix}-${timestamp}-${random}`); // ← Call parent's onChange
  };

  return (
    <FormField
      label="SKU"
      name="sku"
      required
      error={error}
      hint="Unique stock keeping unit identifier"
    >
      <div className="flex gap-2">
        <Input
          id="sku"
          placeholder="SKU-001"
          value={value || ""} // ← Use value prop
          onChange={(e) => onChange(e.target.value)} // ← Call parent's onChange
          disabled={disabled}
          className={cn("flex-1", error && "border-red-500")}
          maxLength={50}
        />
        {autoGenerate && !disabled && (
          <button
            type="button"
            onClick={generateSKU}
            className="px-3 py-2 text-sm border rounded-md hover:bg-muted transition-colors"
          >
            Generate
          </button>
        )}
      </div>
    </FormField>
  );
}
export function ProductDescriptionField({
  defaultValue,
  error,
  disabled,
  onChange,
}) {
  return (
    <FormField label="Description" name="description" error={error}>
      <Textarea
        id="description"
        name="description"
        placeholder="Product description..."
        onChange={(e) => onChange(e.target.value)}
        value={defaultValue}
        disabled={disabled}
        rows={3}
        maxLength={1000}
      />
    </FormField>
  );
}

export function ProductCategoryField({
  value,
  onChange,
  error,
  disabled,
  categories = [],
}) {
  console.log("ProductCategoryField categories:", categories);
  return (
    <FormField label="Category" name="category" required error={error}>
      <CategoryCombobox
        value={value}
        onChange={onChange}
        disabled={disabled}
        error={error}
        categories={categories}
        required
      />
    </FormField>
  );
}

// Controlled select. The wizard owns formData.type and submits via the
// hidden input mounted in AddProductWizard — this Select is purely UI;
// the `name="type"` here would otherwise create a stale duplicate, so
// it's intentionally not set.
export function ProductTypeField({ value, onChange, error, disabled }) {
  const selected = value || "product";
  return (
    <FormField label="Product Type" name="productType" required error={error}>
      <Select value={selected} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn(error && "border-red-500")}>
          <SelectValue placeholder="Select type" />
        </SelectTrigger>
        <SelectContent>
          {PRODUCT_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function ProductUnitField({ value, onChange, error, disabled }) {
  const selected = value || "piece";
  return (
    <FormField label="Unit of Measure" name="unit" required error={error}>
      <Select value={selected} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn(error && "border-red-500")}>
          <SelectValue placeholder="Select unit" />
        </SelectTrigger>
        <SelectContent>
          {UNIT_OPTIONS.map((unit) => (
            <SelectItem key={unit.value} value={unit.value}>
              {unit.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

// ============================================
// PRICING FIELDS (Admin only)
// ============================================

export function CostPriceField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField
      label="Cost Price"
      name="costPrice"
      required
      error={error}
      hint="Your purchase/cost price"
    >
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
          KES
        </span>
        <Input
          id="costPrice"
          name="costPrice"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={defaultValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn("pl-12", error && "border-red-500")}
        />
      </div>
    </FormField>
  );
}

export function SellingPriceField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField
      label="Selling Price"
      name="sellingPrice"
      required
      error={error}
      hint="Default selling price"
    >
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
          KES
        </span>
        <Input
          id="sellingPrice"
          name="sellingPrice"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={defaultValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn("pl-12", error && "border-red-500")}
        />
      </div>
    </FormField>
  );
}

export function MarkupField({ value, disabled, onChange }) {
  return (
    <FormField
      label="Markup %"
      name="markup"
      hint="Auto-calculated from cost and selling price"
    >
      <div className="relative">
        <Input
          id="markup"
          name="markup"
          type="number"
          min="0"
          step="0.01"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={true}
          disabled={true}
          className="pr-8"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
          %
        </span>
      </div>
    </FormField>
  );
}

export function MarginField({ value, readOnly = true, onChange }) {
  return (
    <FormField label="Margin %" name="margin" hint="Profit margin percentage">
      <div className="relative">
        <Input
          id="margin"
          name="margin"
          type="number"
          step="0.01"
          value={value}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className="pr-8 bg-muted"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
          %
        </span>
      </div>
    </FormField>
  );
}

// ============================================
// INVENTORY FIELDS
// ============================================

export function InitialStockField({
  defaultValue = 0,
  error,
  disabled,
  onChange,
}) {
  return (
    <FormField
      label="Initial Stock"
      name="initialStock"
      error={error}
      hint="Opening stock quantity"
    >
      <Input
        id="initialStock"
        name="initialStock"
        type="number"
        min="0"
        step="1"
        placeholder="0"
        value={defaultValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

export function ReorderLevelField({
  defaultValue = 5,
  error,
  disabled,
  onChange,
}) {
  return (
    <FormField
      label="Reorder Level"
      name="reorderLevel"
      error={error}
      hint="Minimum stock before alert"
    >
      <Input
        id="reorderLevel"
        name="reorderLevel"
        type="number"
        min="0"
        step="1"
        placeholder="5"
        value={defaultValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

export function ReorderQuantityField({
  defaultValue = 10,
  error,
  disabled,
  onChange,
}) {
  return (
    <FormField
      label="Reorder Quantity"
      name="reorderQuantity"
      error={error}
      hint="Suggested quantity to order"
    >
      <Input
        id="reorderQuantity"
        name="reorderQuantity"
        type="number"
        min="1"
        step="1"
        placeholder="10"
        value={defaultValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

export function CostingMethodField({ value, onChange, error, disabled }) {
  const selected = value || "weighted_average";
  return (
    <FormField label="Costing Method" name="costingMethod" error={error}>
      <Select value={selected} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn(error && "border-red-500")}>
          <SelectValue placeholder="Select method" />
        </SelectTrigger>
        <SelectContent>
          {COSTING_METHODS.map((method) => (
            <SelectItem key={method.value} value={method.value}>
              {method.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

// ============================================
// LOCATION FIELDS
// ============================================

export function LocationField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField
      label="Storage Location"
      name="location"
      error={error}
      hint="e.g., Warehouse A, Shelf B-12"
    >
      <Input
        id="location"
        name="location"
        placeholder="Warehouse / Shelf / Bin"
        value={defaultValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

export function BinNumberField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField label="Bin Number" name="binNumber" error={error}>
      <Input
        id="binNumber"
        name="binNumber"
        placeholder="e.g., BIN-001"
        value={defaultValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

// ============================================
// TAX FIELDS
// ============================================

export function TaxRateField({ value, onChange, error, disabled }) {
  const selected = value ?? "16";
  return (
    <FormField label="Tax Rate" name="taxRate" error={error}>
      <Select
        value={String(selected)}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger className={cn(error && "border-red-500")}>
          <SelectValue placeholder="Select rate" />
        </SelectTrigger>
        <SelectContent>
          {TAX_RATES.map((rate) => (
            <SelectItem key={rate.value} value={rate.value}>
              {rate.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function TaxExemptField({ defaultChecked = false, disabled, onChange }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <Label htmlFor="taxExempt" className="text-sm font-medium">
          Tax Exempt
        </Label>
        <p className="text-xs text-muted-foreground">
          This product is exempt from VAT
        </p>
      </div>
      <Switch
        id="taxExempt"
        name="taxExempt"
        defaultChecked={defaultChecked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

// ============================================
// SUPPLIER FIELDS
// ============================================

export function SupplierNameField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField label="Default Supplier" name="supplierName" error={error}>
      <Input
        id="supplierName"
        name="supplierName"
        placeholder="Supplier name"
        value={defaultValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

export function SupplierCodeField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField
      label="Supplier Product Code"
      name="supplierCode"
      error={error}
      hint="Supplier's SKU/part number"
    >
      <Input
        id="supplierCode"
        name="supplierCode"
        placeholder="Supplier's code"
        value={defaultValue}
        onChange={(v) => onChange(v.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

export function LeadTimeField({ defaultValue, error, disabled, onChange }) {
  return (
    <FormField
      label="Lead Time (days)"
      name="leadTime"
      error={error}
      hint="Average delivery time from supplier"
    >
      <Input
        id="leadTime"
        name="leadTime"
        type="number"
        min="0"
        step="1"
        placeholder="7"
        value={defaultValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-red-500")}
      />
    </FormField>
  );
}

// ============================================
// STATUS FIELDS
// ============================================

export function ActiveStatusField({ defaultChecked = true, disabled }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <Label htmlFor="isActive" className="text-sm font-medium">
          Active
        </Label>
        <p className="text-xs text-muted-foreground">
          Product is available for transactions
        </p>
      </div>
      <Switch
        id="isActive"
        name="isActive"
        defaultChecked={defaultChecked}
        disabled={disabled}
      />
    </div>
  );
}

export function TrackInventoryField({
  defaultChecked = true,
  disabled,
  onChange,
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <Label htmlFor="trackInventory" className="text-sm font-medium">
          Track Inventory
        </Label>
        <p className="text-xs text-muted-foreground">
          Monitor stock levels for this product
        </p>
      </div>
      <Switch
        id="trackInventory"
        name="trackInventory"
        defaultChecked={defaultChecked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export function AllowNegativeStockField({
  defaultChecked = false,
  disabled,
  onChange,
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <Label htmlFor="allowNegativeStock" className="text-sm font-medium">
          Allow Negative Stock
        </Label>
        <p className="text-xs text-muted-foreground">
          Allow sales even when out of stock
        </p>
      </div>
      <Switch
        onChange={(checked) => onChange(checked)}
        id="allowNegativeStock"
        name="allowNegativeStock"
        checked={defaultChecked}
        disabled={disabled}
      />
    </div>
  );
}
