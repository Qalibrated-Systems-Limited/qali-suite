"use client";

import * as React from "react";
import { useState, useActionState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Package,
  DollarSign,
  Warehouse,
  ClipboardCheck,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

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
  InitialStockField,
  ReorderLevelField,
  ReorderQuantityField,
  CostingMethodField,
  TrackInventoryField,
  AllowNegativeStockField,
  LocationField,
  BinNumberField,
  TaxRateField,
  ActiveStatusField,
} from "./ProductFormField";

import { addProduct } from "../../../mongodb/actions/stock-actions";

// ============================================
// STEP DEFINITIONS
// ============================================

const STEPS = [
  {
    id: "basic",
    title: "Basic Info",
    shortTitle: "Basic",
    icon: Package,
    description: "Product name, SKU, and category",
  },
  {
    id: "pricing",
    title: "Pricing",
    shortTitle: "Pricing",
    icon: DollarSign,
    description: "Cost and selling prices",
    adminOnly: true,
  },
  {
    id: "inventory",
    title: "Inventory",
    shortTitle: "Inventory",
    icon: Warehouse,
    description: "Stock and tracking settings",
  },
  {
    id: "review",
    title: "Review",
    shortTitle: "Review",
    icon: ClipboardCheck,
    description: "Review and submit",
  },
];

// ============================================
// STEP INDICATOR
// ============================================

function StepIndicator({ steps, currentStep, completedSteps, onStepClick }) {
  return (
    <>
      {/* Mobile: Dots only */}
      <div className="flex sm:hidden justify-center gap-2 mb-6">
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepClick(index)}
            className={cn(
              "w-3 h-3 rounded-full transition-all",
              index === currentStep
                ? "bg-yellow-500 scale-110"
                : completedSteps.includes(step.id)
                ? "bg-green-500"
                : "bg-muted"
            )}
            aria-label={step.title}
          />
        ))}
      </div>

      {/* Desktop: Full stepper */}
      <div className="hidden sm:flex items-center justify-between mb-8">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === currentStep;
          const isCompleted = completedSteps.includes(step.id);
          const isPast = index < currentStep;

          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => onStepClick(index)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg transition-all",
                  isActive && "bg-yellow-500/10 ring-2 ring-yellow-500",
                  (isCompleted || isPast) && !isActive && "opacity-70"
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                    isActive
                      ? "bg-yellow-500 text-black"
                      : isCompleted
                      ? "bg-green-500 text-white"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <div className="text-left">
                  <p
                    className={cn(
                      "font-medium text-sm",
                      isActive && "text-yellow-600"
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground hidden lg:block">
                    {step.description}
                  </p>
                </div>
              </button>

              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    isPast || isCompleted ? "bg-green-500" : "bg-muted"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}

// ============================================
// STEP CONTENT COMPONENTS
// ============================================

function BasicInfoStep({ formData, setFormData, errors, categories }) {
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <ProductNameField
          value={formData.name}
          onChange={(v) => handleChange("name", v)}
          error={errors?.name?.[0]}
        />
        <ProductSKUField
          value={formData.sku}
          onChange={(v) => handleChange("sku", v)}
          productName={formData.name}
          error={errors?.sku?.[0]}
        />
      </div>

      <ProductCategoryField
        categories={categories}
        value={formData.category}
        onChange={(v) => handleChange("category", v)}
        error={errors?.category?.[0]}
      />

      <ProductDescriptionField
        defaultValue={formData.description}
        onChange={(v) => handleChange("description", v)}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <ProductTypeField
          value={formData.type}
          onChange={(v) => handleChange("type", v)}
        />
        <ProductUnitField
          value={formData.unit}
          onChange={(v) => handleChange("unit", v)}
        />
      </div>
    </div>
  );
}

function PricingStep({ formData, setFormData, errors }) {
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Calculate markup and margin
  const cost = parseFloat(formData.costPrice) || 0;
  const selling = parseFloat(formData.sellingPrice) || 0;
  const markup = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
  const margin = selling > 0 ? ((selling - cost) / selling) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <CostPriceField
          value={formData.costPrice}
          onChange={(v) => handleChange("costPrice", v)}
          error={errors?.costPrice?.[0]}
        />
        <SellingPriceField
          value={formData.sellingPrice}
          onChange={(v) => handleChange("sellingPrice", v)}
          error={errors?.sellingPrice?.[0]}
        />
      </div>

      {/* Auto-calculated margins */}
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

      <TaxRateField
        value={formData.taxRate}
        onChange={(v) => handleChange("taxRate", v)}
      />
    </div>
  );
}

function InventoryStep({ formData, setFormData, errors }) {
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      <TrackInventoryField
        value={formData.trackInventory}
        onChange={(v) => handleChange("trackInventory", v)}
      />

      {formData.trackInventory && (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <InitialStockField
              defaultValue={formData.initialStock}
              onChange={(v) => handleChange("initialStock", v)}
              error={errors?.initialStock?.[0]}
            />
            <CostingMethodField
              defaultValue={formData.costingMethod}
              onChange={(v) => handleChange("costingMethod", v)}
            />
          </div>

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

          <AllowNegativeStockField
            defaultChecked={formData.allowNegativeStock}
            onChange={(v) => handleChange("allowNegativeStock", v)}
          />
        </>
      )}
    </div>
  );
}

function ReviewStep({ formData, canEditPricing }) {
  const cost = parseFloat(formData.costPrice) || 0;
  const selling = parseFloat(formData.sellingPrice) || 0;

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{formData.name || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">SKU</span>
            <span className="font-mono">{formData.sku || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Category</span>
            <span>{formData.categoryName || formData.category || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <span className="capitalize">{formData.type || "product"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Unit</span>
            <span>{formData.unit || "piece"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Pricing - only show if user can view */}
      {canEditPricing && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cost Price</span>
              <span className="font-medium">
                KES {cost.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selling Price</span>
              <span className="font-medium">
                KES{" "}
                {selling.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {cost > 0 && selling > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Markup</span>
                  <span>{(((selling - cost) / cost) * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margin</span>
                  <span>
                    {(((selling - cost) / selling) * 100).toFixed(1)}%
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax Rate</span>
              <span>{formData.taxRate || 16}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Warehouse className="h-4 w-4" />
            Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Track Inventory</span>
            <Badge variant={formData.trackInventory ? "default" : "secondary"}>
              {formData.trackInventory ? "Yes" : "No"}
            </Badge>
          </div>
          {formData.trackInventory && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Initial Stock</span>
                <span>{formData.initialStock || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reorder Level</span>
                <span>{formData.reorderLevel || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Costing Method</span>
                <span className="uppercase">
                  {formData.costingMethod || "weighted_average"}
                </span>
              </div>
              {formData.location && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span>{formData.location}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// MAIN WIZARD COMPONENT
// ============================================

export default function AddProductWizard({
  userRole = "employee",
  categories = [],
}) {
  // Check if user can edit pricing
  const canEditPricing = ["admin", "manager"].includes(userRole.toLowerCase());

  // Filter steps based on role
  const visibleSteps = STEPS.filter(
    (step) => !step.adminOnly || canEditPricing
  );

  // State
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [clientErrors, setClientErrors] = useState({});
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    description: "",
    category: "",
    categoryName: "",
    type: "product",
    unit: "piece",
    costPrice: "",
    sellingPrice: "",
    taxRate: "16",
    initialStock: "",
    reorderLevel: "10",
    reorderQuantity: "20",
    costingMethod: "weighted_average",
    location: "",
    binNumber: "",
    trackInventory: true,
    allowNegativeStock: false,
    isActive: true,
  });

  // Form action state - NO useEffect needed!
  // Errors are read directly from state in JSX
  const [state, formAction, isPending] = useActionState(addProduct, null);

  // Combine server errors with client validation errors
  const errors = state?.error || clientErrors;

  // Validate current step (client-side)
  const validateStep = (stepId) => {
    const newErrors = {};

    switch (stepId) {
      case "basic":
        if (!formData.name?.trim())
          newErrors.name = ["Product name is required"];
        if (!formData.sku?.trim()) newErrors.sku = ["SKU is required"];
        if (!formData.category) newErrors.category = ["Category is required"];
        break;

      case "pricing":
        if (canEditPricing) {
          if (!formData.costPrice || parseFloat(formData.costPrice) < 0) {
            newErrors.costPrice = ["Valid cost price is required"];
          }
          if (!formData.sellingPrice || parseFloat(formData.sellingPrice) < 0) {
            newErrors.sellingPrice = ["Valid selling price is required"];
          }
        }
        break;

      case "inventory":
        if (formData.trackInventory) {
          const initialStock = Number(formData.initialStock);
          if (formData.initialStock && (!Number.isInteger(initialStock) || initialStock < 0)) {
            newErrors.initialStock = ["Initial stock must be a non-negative whole number"];
          }
          const reorderLevel = Number(formData.reorderLevel);
          if (formData.reorderLevel && (!Number.isInteger(reorderLevel) || reorderLevel < 0)) {
            newErrors.reorderLevel = ["Reorder level must be a non-negative whole number"];
          }
          const reorderQty = Number(formData.reorderQuantity);
          if (formData.reorderQuantity && (!Number.isInteger(reorderQty) || reorderQty < 0)) {
            newErrors.reorderQuantity = ["Reorder quantity must be a non-negative whole number"];
          }
        }
        break;
    }

    return { isValid: Object.keys(newErrors).length === 0, errors: newErrors };
  };

  // Navigation
  const goToStep = (index) => {
    if (index >= 0 && index < visibleSteps.length) {
      setCurrentStep(index);
    }
  };

  const nextStep = () => {
    const currentStepId = visibleSteps[currentStep].id;
    const { isValid, errors: validationErrors } = validateStep(currentStepId);

    if (isValid) {
      setClientErrors({});
      if (!completedSteps.includes(currentStepId)) {
        setCompletedSteps((prev) => [...prev, currentStepId]);
      }
      setCurrentStep((prev) => Math.min(prev + 1, visibleSteps.length - 1));
    } else {
      setClientErrors(validationErrors);
    }
  };

  const prevStep = () => {
    setClientErrors({});
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  // Render current step content
  const renderStepContent = () => {
    const stepId = visibleSteps[currentStep]?.id;

    switch (stepId) {
      case "basic":
        return (
          <BasicInfoStep
            categories={categories}
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case "pricing":
        return (
          <PricingStep
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case "inventory":
        return (
          <InventoryStep
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        );
      case "review":
        return (
          <ReviewStep formData={formData} canEditPricing={canEditPricing} />
        );
      default:
        return null;
    }
  };

  const isLastStep = currentStep === visibleSteps.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Step Indicator */}
      <StepIndicator
        steps={visibleSteps}
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={goToStep}
      />

      {/* Form-level Error from server */}
      {state?.error?._form && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error._form[0]}</AlertDescription>
        </Alert>
      )}

      {/* Form - wraps all steps, submits on final step */}
      <form action={formAction}>
        {/* Hidden inputs to pass all form data */}
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
        <input
          type="hidden"
          name="initialStock"
          value={formData.initialStock}
        />
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

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {React.createElement(visibleSteps[currentStep].icon, {
                className: "h-5 w-5",
              })}
              {visibleSteps[currentStep].title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {visibleSteps[currentStep].description}
            </p>
          </CardHeader>
          <CardContent>{renderStepContent()}</CardContent>
        </Card>

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={prevStep}
            disabled={isFirstStep || isPending}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous
          </Button>

          {isLastStep ? (
            <Button
              type="submit"
              disabled={isPending}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Create Product
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={nextStep}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              Next
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
