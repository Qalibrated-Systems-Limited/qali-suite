"use client";

import { useState, useActionState } from "react";
import {
  Package,
  DollarSign,
  Warehouse,
  MapPin,
  Truck,
  Settings,
  Loader2,
  AlertCircle,
  ChevronDown,
  Lock,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import Link from "next/link";

import {
  ProductNameField,
  ProductSKUField,
  ProductDescriptionField,
  ProductCategoryField,
  ProductTypeField,
  ProductUnitField,
  CostPriceField,
  SellingPriceField,
  MarkupField,
  MarginField,
  ReorderLevelField,
  ReorderQuantityField,
  CostingMethodField,
  TrackInventoryField,
  AllowNegativeStockField,
  LocationField,
  BinNumberField,
  TaxRateField,
  TaxExemptField,
  SupplierNameField,
  SupplierCodeField,
  LeadTimeField,
  ActiveStatusField,
} from "../../components/ProductFormField";

import { updateProduct } from "../../../../mongodb/actions/stock-actions";
import {
  canSeePricing as canSeePricingRole,
  canEditPricing as canEditPricingRole,
} from "@/lib/permissions";

// ============================================
// COLLAPSIBLE SECTION COMPONENT
// ============================================

function FormSection({
  title,
  icon: Icon,
  badge,
  children,
  defaultOpen = false,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {title}
                {badge && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {badge}
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ============================================
// STOCK STATUS CARD (Read-only)
// ============================================

function StockStatusCard({ product }) {
  const onHand = product.inventory?.quantityOnHand ?? 0;
  const committed = product.inventory?.quantityCommitted ?? 0;
  const available = onHand - committed;
  const costPrice = product.costPrice || 0;
  const inventoryValue = onHand * costPrice;

  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Warehouse className="h-4 w-4" />
          Current Stock Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-background rounded-lg">
            <p className="text-2xl font-bold">{onHand}</p>
            <p className="text-xs text-muted-foreground">On Hand</p>
          </div>
          <div className="text-center p-3 bg-background rounded-lg">
            <p className="text-2xl font-bold">{committed}</p>
            <p className="text-xs text-muted-foreground">Committed</p>
          </div>
          <div className="text-center p-3 bg-background rounded-lg">
            <p
              className={cn(
                "text-2xl font-bold",
                available <= 0 && "text-red-500",
                available > 0 &&
                  available <= (product.reorderLevel || 10) &&
                  "text-yellow-500"
              )}
            >
              {available}
            </p>
            <p className="text-xs text-muted-foreground">Available</p>
          </div>
          <div className="text-center p-3 bg-background rounded-lg">
            <p className="text-2xl font-bold">
              {inventoryValue.toLocaleString("en-KE", {
                style: "currency",
                currency: "KES",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
            </p>
            <p className="text-xs text-muted-foreground">Value</p>
          </div>
        </div>

        <Alert className="mt-4">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Stock quantities cannot be edited here. Use{" "}
            <strong>Stock Adjustment</strong> to correct inventory levels.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

// ============================================
// PRICING READ-ONLY CARD (For non-admins)
// ============================================

function PricingReadOnlyCard({ product }) {
  const cost = product.costPrice || 0;
  const selling = product.sellingPrice || 0;
  const markup = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
  const margin = selling > 0 ? ((selling - cost) / selling) * 100 : 0;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Pricing
          <Badge variant="outline" className="ml-2 text-xs">
            <Lock className="h-3 w-3 mr-1" />
            View Only
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-lg font-semibold">
              KES {cost.toLocaleString("en-KE")}
            </p>
            <p className="text-xs text-muted-foreground">Cost Price</p>
          </div>
          <div>
            <p className="text-lg font-semibold">
              KES {selling.toLocaleString("en-KE")}
            </p>
            <p className="text-xs text-muted-foreground">Selling Price</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{markup.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Markup</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{margin.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Margin</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 text-center">
          Contact an administrator to modify pricing.
        </p>
      </CardContent>
    </Card>
  );
}

// ============================================
// MAIN UPDATE FORM COMPONENT
// ============================================

export default function UpdateProductForm({
  product,
  userRole = "employee",
  categories = [],
}) {
  // Single source of truth: lib/permissions.js
  // - canEditPricing: Admin / SuperAdmin / CFO / Finance Manager / Sales Manager
  // - canSeePricing: above + Accountant / Procurement / Store Manager / Manager
  // - non-pricing roles (Storekeeper / Employee / Technician): no pricing UI
  const canEditPricing = canEditPricingRole(userRole);
  const canSeePricing = canSeePricingRole(userRole);

  // Bind product ID to action
  const boundUpdateAction = updateProduct.bind(null, product._id.toString());

  // Form action state - NO useEffect needed!
  const [state, formAction, isPending] = useActionState(
    boundUpdateAction,
    null
  );

  // Local form state for controlled inputs
  const [formData, setFormData] = useState({
    name: product.name || "",
    sku: product.SKU || "",
    description: product.description || "",
    // Use categoryId which is the ObjectId, not category which is the name string
    category: product.categoryId || "",
    type: product.type || "product",
    unit: product.unit || "piece",
    costPrice: product.costing?.costPrice?.toString() || "",
    sellingPrice: product.pricing?.sellingPrice?.toString() || "",
    taxRate: product.taxRate?.toString() || "16",
    taxExempt: product.taxExempt || false,
    reorderLevel: product.inventory?.reorderLevel?.toString() || "10",
    reorderQuantity: product.inventory?.reorderQuantity?.toString() || "20",
    costingMethod: product.costing?.costingMethod || "weighted_average",
    location: product.storeInfo?.location || "",
    binNumber: product.storeInfo?.binNumber || "",
    trackInventory: product.storeInfo?.trackInventory ?? true,
    allowNegativeStock: product.storeInfo?.allowNegativeStock || false,
    isActive: product.isActive ?? true,
    supplierName: product.supplier?.name || "",
    supplierCode: product.supplier?.code || "",
    leadTime: product.supplier?.leadTime?.toString() || "",
  });

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Calculate markup and margin for pricing section
  const cost = parseFloat(formData.costPrice) || 0;
  const selling = parseFloat(formData.sellingPrice) || 0;
  const markup = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
  const margin = selling > 0 ? ((selling - cost) / selling) * 100 : 0;

  // Get errors from server state
  const errors = state?.error || {};

  return (
    <div className="space-y-6">
      {/* Form-level Error */}
      {errors._form && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errors._form[0]}</AlertDescription>
        </Alert>
      )}

      {/* Stock Status Card */}
      <StockStatusCard product={product} />

      {/* Main Form */}
      <form action={formAction} className="space-y-4">
        {/* Hidden inputs */}
        <input type="hidden" name="name" value={formData.name} />
        <input type="hidden" name="sku" value={formData.sku} />
        <input type="hidden" name="description" value={formData.description} />
        <input type="hidden" name="category" value={formData.category} />
        <input type="hidden" name="type" value={formData.type} />
        <input type="hidden" name="unit" value={formData.unit} />
        <input type="hidden" name="costPrice" value={formData.costPrice} />
        <input
          type="hidden"
          name="sellingPrice"
          value={formData.sellingPrice}
        />
        <input type="hidden" name="taxRate" value={formData.taxRate} />
        <input type="hidden" name="taxExempt" value={formData.taxExempt} />
        <input
          type="hidden"
          name="reorderLevel"
          value={formData.reorderLevel}
        />
        <input
          type="hidden"
          name="reorderQuantity"
          value={formData.reorderQuantity}
        />
        <input
          type="hidden"
          name="costingMethod"
          value={formData.costingMethod}
        />
        <input type="hidden" name="location" value={formData.location} />
        <input type="hidden" name="binNumber" value={formData.binNumber} />
        <input
          type="hidden"
          name="trackInventory"
          value={formData.trackInventory}
        />
        <input
          type="hidden"
          name="allowNegativeStock"
          value={formData.allowNegativeStock}
        />
        <input type="hidden" name="isActive" value={formData.isActive} />
        <input
          type="hidden"
          name="supplierName"
          value={formData.supplierName}
        />
        <input
          type="hidden"
          name="supplierCode"
          value={formData.supplierCode}
        />
        <input type="hidden" name="leadTime" value={formData.leadTime} />

        {/* Basic Information */}
        <FormSection
          title="Basic Information"
          icon={Package}
          defaultOpen={true}
        >
          <div className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <ProductNameField
                value={formData.name}
                onChange={(v) => handleChange("name", v)}
                error={errors.name?.[0]}
              />
              <ProductSKUField
                value={formData.sku}
                onChange={(v) => handleChange("sku", v)}
                error={errors.sku?.[0]}
                disabled
              />
            </div>

            <ProductCategoryField
              value={formData.category}
              onChange={(v) => handleChange("category", v)}
              error={errors.category?.[0]}
              categories={categories}
            />

            <ProductDescriptionField
              defaultValue={formData.description}
              onChange={(v) => handleChange("description", v)}
            />

            <div className="grid gap-6 sm:grid-cols-2">
              <ProductTypeField
                defaultValue={formData.type}
                onChange={(v) => handleChange("type", v)}
                error={errors.type?.[0]}
              />
              <ProductUnitField
                defaultValue={formData.unit}
                onChange={(v) => handleChange("unit", v)}
                error={errors.unit?.[0]}
              />
            </div>

            <ActiveStatusField
              defaultChecked={formData.isActive}
              onChange={(v) => handleChange("isActive", v)}
            />
          </div>
        </FormSection>

        {/* Pricing — three states:
            • Edit (Admin / CFO / Finance / Sales Manager): full inputs
            • Read-only (Store Manager / Accountant / Procurement / Manager):
              displayed but uneditable, with hint to use Manage pricing
            • Hidden (Storekeeper / Employee / Technician / Viewer): redacted.
              These roles shouldn't see cost / selling / margin at all. */}
        {canEditPricing ? (
          <FormSection title="Pricing" icon={DollarSign} badge="Admin">
            <div className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <CostPriceField
                  defaultValue={formData.costPrice}
                  onChange={(v) => handleChange("costPrice", v)}
                  error={errors.costPrice?.[0]}
                />
                <SellingPriceField
                  defaultValue={formData.sellingPrice}
                  onChange={(v) => handleChange("sellingPrice", v)}
                  error={errors.sellingPrice?.[0]}
                />
              </div>

              {cost > 0 && selling > 0 && (
                <div className="grid gap-6 sm:grid-cols-2">
                  <MarkupField
                    value={markup.toFixed(2)}
                    readOnly
                    onChange={(v) => handleChange("markup", v)}
                  />
                  <MarginField
                    value={margin.toFixed(2)}
                    readOnly
                    onChange={(v) => handleChange("margin", v)}
                  />
                </div>
              )}
            </div>
          </FormSection>
        ) : canSeePricing ? (
          <PricingReadOnlyCard product={product} />
        ) : null}

        {/* Tax Settings */}
        <FormSection title="Tax Settings" icon={Settings}>
          <div className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <TaxRateField
                defaultValue={formData.taxRate}
                onChange={(v) => handleChange("taxRate", v)}
              />
              <TaxExemptField
                defaultChecked={formData.taxExempt}
                onChange={(v) => handleChange("taxExempt", v)}
              />
            </div>
          </div>
        </FormSection>

        {/* Inventory Settings */}
        <FormSection title="Inventory Settings" icon={Warehouse}>
          <div className="space-y-6">
            <TrackInventoryField
              defaultChecked={formData.trackInventory}
              onChange={(v) => handleChange("trackInventory", v)}
            />

            {formData.trackInventory && (
              <>
                <div className="grid gap-6 sm:grid-cols-2">
                  <ReorderLevelField
                    defaultValue={formData.reorderLevel}
                    onChange={(v) => handleChange("reorderLevel", v)}
                  />
                  <ReorderQuantityField
                    defaultValue={formData.reorderQuantity}
                    onChange={(v) => handleChange("reorderQuantity", v)}
                  />
                </div>

                <CostingMethodField
                  defaultValue={formData.costingMethod}
                  onChange={(v) => handleChange("costingMethod", v)}
                />

                <AllowNegativeStockField
                  defaultChecked={formData.allowNegativeStock}
                  onChange={(v) => handleChange("allowNegativeStock", v)}
                />
              </>
            )}
          </div>
        </FormSection>

        {/* Location */}
        <FormSection title="Location" icon={MapPin}>
          <div className="grid gap-6 sm:grid-cols-2">
            <LocationField
              defaultValue={formData.location}
              onChange={(v) => handleChange("location", v)}
            />
            <BinNumberField
              defaultValue={formData.binNumber}
              onChange={(v) => handleChange("binNumber", v)}
            />
          </div>
        </FormSection>

        {/* Supplier Info */}
        <FormSection title="Supplier Information" icon={Truck}>
          <div className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <SupplierNameField
                defaultValue={formData.supplierName}
                onChange={(v) => handleChange("supplierName", v)}
              />
              <SupplierCodeField
                defaultValue={formData.supplierCode}
                onChange={(v) => handleChange("supplierCode", v)}
              />
            </div>
            <LeadTimeField
              defaultValue={formData.leadTime}
              onChange={(v) => handleChange("leadTime", v)}
            />
          </div>
        </FormSection>

        {/* Submit Button */}
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/dashboard/stocks">Cancel</Link>
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
