"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { addProduct } from "../../../mongodb/actions/stock-actions";

import { cn } from "@/lib/utils";

// Icons
import {

  Package,
  DollarSign,
  Warehouse,
  Settings,
  FileText,
  Tag,
  Hash,
  Layers,
  Scale,
  TrendingUp,
  Percent,
  MapPin,
  Building,
  Receipt,
  Truck,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";

// UI Components
import { Button } from "@/components/ui/button";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { units } from "@/app/utils/units";

// Product categories - adjust based on your business
const categories = [
  "Loadcells",
  "Indicators",
  "Platforms",
  "Spare Parts",
  "Cables",
  "Accessories",
  "Scales",

  "Other",
];

// ============================================
// FORM SECTION COMPONENT
// ============================================
function FormSection({
  title,
  icon: Icon,
  children,
  collapsible = false,
  defaultOpen = true,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Card className="border-border/50">
      <CardHeader
        className={cn("pb-4", collapsible && "cursor-pointer select-none")}
        onClick={() => collapsible && setIsOpen(!isOpen)}
      >
        <CardTitle className="flex items-center justify-between text-base font-medium">
          <span className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            {title}
          </span>
          {collapsible && (
            <span className="text-muted-foreground">
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      {(!collapsible || isOpen) && (
        <CardContent className="pt-0">{children}</CardContent>
      )}
    </Card>
  );
}

// ============================================
// FIELD ERROR COMPONENT
// ============================================
function FieldError({ errors }) {
  if (!errors || errors.length === 0) return null;

  return (
    <div className="flex items-start gap-1.5 mt-1.5">
      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
      <span className="text-xs text-destructive">{errors[0]}</span>
    </div>
  );
}

// ============================================
// ADD PRODUCT FORM
// ============================================
export  function AddProductForm({ onSuccess, onCancel }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(addProduct, {});
  const [taxable, setTaxable] = useState(true);

  // Handle successful submission
  if (state?.success) {
    if (onSuccess) {
      onSuccess(state);
    } else {
      router.push("/dashboard/stock");
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      {/* Form Error */}
      {state?.errors?._form && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-destructive/90">
                {state.errors._form[0]}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* BASIC INFORMATION */}
      {/* ============================================ */}
      <FormSection title="Basic Information" icon={Package}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Product Name */}
          <div className="sm:col-span-2">
            <Label htmlFor="name" className="text-sm font-medium">
              Product Name <span className="text-destructive">*</span>
            </Label>
            <div className="relative mt-1.5">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="name"
                name="name"
                placeholder="e.g., Loadcell 10kg Single Point"
                className={cn(
                  "pl-10",
                  state?.errors?.name &&
                    "border-destructive focus-visible:ring-destructive"
                )}
                required
              />
            </div>
            <FieldError errors={state?.errors?.name} />
          </div>

          {/* SKU */}
          <div>
            <Label htmlFor="SKU" className="text-sm font-medium">
              SKU <span className="text-destructive">*</span>
            </Label>
            <div className="relative mt-1.5">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="SKU"
                name="SKU"
                placeholder="e.g., LC-10KG-SP"
                className={cn(
                  "pl-10 uppercase",
                  state?.errors?.SKU &&
                    "border-destructive focus-visible:ring-destructive"
                )}
                style={{ textTransform: "uppercase" }}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Uppercase letters, numbers, and dashes only
            </p>
            <FieldError errors={state?.errors?.SKU} />
          </div>

          {/* Category */}
          <div>
            <Label htmlFor="category" className="text-sm font-medium">
              Category <span className="text-destructive">*</span>
            </Label>
            <Select name="category" required>
              <SelectTrigger
                className={cn(
                  "mt-1.5",
                  state?.errors?.category && "border-destructive"
                )}
              >
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={state?.errors?.category} />
          </div>

          {/* Unit */}
          <div>
            <Label htmlFor="unit" className="text-sm font-medium">
              Unit <span className="text-destructive">*</span>
            </Label>
            <Select name="unit" defaultValue="pcs" required>
              <SelectTrigger
                className={cn(
                  "mt-1.5",
                  state?.errors?.unit && "border-destructive"
                )}
              >
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={state?.errors?.unit} />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <Label htmlFor="description" className="text-sm font-medium">
              Description
            </Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Product description, specifications, or notes..."
              className="mt-1.5 min-h-20 resize-none"
              rows={3}
            />
            <FieldError errors={state?.errors?.description} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* PRICING */}
      {/* ============================================ */}
      <FormSection title="Pricing" icon={DollarSign}>
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Selling Price */}
          <div>
            <Label htmlFor="sellingPrice" className="text-sm font-medium">
              Selling Price <span className="text-destructive">*</span>
            </Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                KES
              </span>
              <Input
                id="sellingPrice"
                name="sellingPrice"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className={cn(
                  "pl-12",
                  state?.errors?.sellingPrice && "border-destructive"
                )}
                required
              />
            </div>
            <FieldError errors={state?.errors?.sellingPrice} />
          </div>

          {/* Wholesale Price */}
          <div>
            <Label htmlFor="wholesalePrice" className="text-sm font-medium">
              Wholesale Price
            </Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                KES
              </span>
              <Input
                id="wholesalePrice"
                name="wholesalePrice"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="pl-12"
              />
            </div>
            <FieldError errors={state?.errors?.wholesalePrice} />
          </div>

          {/* Minimum Price */}
          <div>
            <Label htmlFor="minimumPrice" className="text-sm font-medium">
              Minimum Price
            </Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                KES
              </span>
              <Input
                id="minimumPrice"
                name="minimumPrice"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="pl-12"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Sales below this need approval
            </p>
            <FieldError errors={state?.errors?.minimumPrice} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* COSTING & INITIAL STOCK */}
      {/* ============================================ */}
      <FormSection title="Costing & Initial Stock" icon={TrendingUp}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Cost Price */}
          <div>
            <Label htmlFor="costPrice" className="text-sm font-medium">
              Cost Price <span className="text-destructive">*</span>
            </Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                KES
              </span>
              <Input
                id="costPrice"
                name="costPrice"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className={cn(
                  "pl-12",
                  state?.errors?.costPrice && "border-destructive"
                )}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average cost per unit (for COGS calculation)
            </p>
            <FieldError errors={state?.errors?.costPrice} />
          </div>

          {/* Initial Quantity */}
          <div>
            <Label htmlFor="initialQuantity" className="text-sm font-medium">
              Initial Stock Quantity
            </Label>
            <div className="relative mt-1.5">
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="initialQuantity"
                name="initialQuantity"
                type="number"
                min="0"
                step="1"
                defaultValue="0"
                placeholder="0"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Opening stock (no journal entry created)
            </p>
            <FieldError errors={state?.errors?.initialQuantity} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* INVENTORY SETTINGS */}
      {/* ============================================ */}
      <FormSection
        title="Inventory Settings"
        icon={Settings}
        collapsible
        defaultOpen={false}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Reorder Point */}
          <div>
            <Label htmlFor="reorderPoint" className="text-sm font-medium">
              Reorder Point
            </Label>
            <div className="relative mt-1.5">
              <AlertCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="reorderPoint"
                name="reorderPoint"
                type="number"
                min="0"
                step="1"
                defaultValue="0"
                placeholder="0"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Alert when stock falls to this level
            </p>
            <FieldError errors={state?.errors?.reorderPoint} />
          </div>

          {/* Reorder Quantity */}
          <div>
            <Label htmlFor="reorderQuantity" className="text-sm font-medium">
              Reorder Quantity
            </Label>
            <div className="relative mt-1.5">
              <Plus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="reorderQuantity"
                name="reorderQuantity"
                type="number"
                min="0"
                step="1"
                defaultValue="0"
                placeholder="0"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Suggested quantity to order
            </p>
            <FieldError errors={state?.errors?.reorderQuantity} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* LOCATION */}
      {/* ============================================ */}
      <FormSection
        title="Storage Location"
        icon={MapPin}
        collapsible
        defaultOpen={false}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Warehouse */}
          <div>
            <Label htmlFor="warehouse" className="text-sm font-medium">
              Warehouse
            </Label>
            <div className="relative mt-1.5">
              <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="warehouse"
                name="warehouse"
                placeholder="Main"
                defaultValue="Main"
                className="pl-10"
              />
            </div>
            <FieldError errors={state?.errors?.warehouse} />
          </div>

          {/* Bin */}
          <div>
            <Label htmlFor="bin" className="text-sm font-medium">
              Bin / Rack
            </Label>
            <Input
              id="bin"
              name="bin"
              placeholder="e.g., A1"
              className="mt-1.5"
            />
            <FieldError errors={state?.errors?.bin} />
          </div>

          {/* Shelf */}
          <div>
            <Label htmlFor="shelf" className="text-sm font-medium">
              Shelf
            </Label>
            <Input
              id="shelf"
              name="shelf"
              placeholder="e.g., Top"
              className="mt-1.5"
            />
            <FieldError errors={state?.errors?.shelf} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* TAX SETTINGS */}
      {/* ============================================ */}
      <FormSection
        title="Tax Settings"
        icon={Receipt}
        collapsible
        defaultOpen={false}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Taxable */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="taxable" className="text-sm font-medium">
                Taxable Product
              </Label>
              <p className="text-xs text-muted-foreground">
                Apply VAT to this product
              </p>
            </div>
            <Switch
              id="taxable"
              name="taxable"
              checked={taxable}
              onCheckedChange={setTaxable}
              value={taxable ? "true" : "false"}
            />
          </div>

          {/* Tax Rate */}
          <div>
            <Label htmlFor="taxRate" className="text-sm font-medium">
              Tax Rate (%)
            </Label>
            <div className="relative mt-1.5">
              <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="taxRate"
                name="taxRate"
                type="number"
                min="0"
                max="100"
                step="0.5"
                defaultValue="16"
                placeholder="16"
                className="pl-10"
                disabled={!taxable}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Kenya VAT: 16%</p>
            <FieldError errors={state?.errors?.taxRate} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* SUPPLIER INFO */}
      {/* ============================================ */}
      <FormSection
        title="Supplier Information"
        icon={Truck}
        collapsible
        defaultOpen={false}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Default Supplier ID */}
          <div>
            <Label htmlFor="defaultSupplierId" className="text-sm font-medium">
              Default Supplier
            </Label>
            <Input
              id="defaultSupplierId"
              name="defaultSupplierId"
              placeholder="Supplier ID (optional)"
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Link to Party record
            </p>
            <FieldError errors={state?.errors?.defaultSupplierId} />
          </div>

          {/* Supplier SKU */}
          <div>
            <Label htmlFor="supplierSKU" className="text-sm font-medium">
              Supplier SKU
            </Label>
            <Input
              id="supplierSKU"
              name="supplierSKU"
              placeholder="Supplier's product code"
              className="mt-1.5"
            />
            <FieldError errors={state?.errors?.supplierSKU} />
          </div>
        </div>
      </FormSection>

      {/* ============================================ */}
      {/* FORM ACTIONS */}
      {/* ============================================ */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isPending}
          className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-black"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Create Product
            </>
          )}
        </Button>
      </div>

      {/* Success Message (if staying on page) */}
      {state?.success && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4">
          <p className="text-sm text-green-600 dark:text-green-400">
            ✓ {state.message}
          </p>
        </div>
      )}
    </form>
  );
}
