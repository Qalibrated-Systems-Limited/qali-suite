"use client";

import * as React from "react";
import { useState, useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
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

import { addProductPg } from "@/app/db/actions/product-actions";
import { createCategoryQuickPg } from "@/app/db/actions/category-actions";
import { canSetProductCost, canEditPricing as canSetSellingPrice } from "@/lib/permissions";

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

/**
 * WHICH STEP OWNS WHICH FIELD.
 *
 * `addProductPg` refuses with a FIELD error — `sku`, `initialStock`,
 * `category` — and those render beside their input, on the step that holds it.
 * The last step is Review, which holds no inputs and rendered only
 * `error._form`. So every field-scoped refusal arrived on a screen with
 * nowhere to show it: the button went to "Creating…", came back, and nothing
 * whatsoever appeared. The report was "the create product button does not
 * submit" — it submitted every time and was refused in silence.
 *
 * The three that actually bite are all ones the client cannot pre-empt: a SKU
 * that is already taken, a category deleted since the picker loaded, and
 * opening stock on a product with no cost — which is most products, since cost
 * is an output of receiving stock and not a field the wizard sets.
 */
const FIELD_STEP = {
  name: "basic",
  sku: "basic",
  category: "basic",
  type: "basic",
  unit: "basic",
  description: "basic",
  costPrice: "pricing",
  sellingPrice: "pricing",
  taxRate: "pricing",
  initialStock: "inventory",
  reorderLevel: "inventory",
  reorderQuantity: "inventory",
  costingMethod: "inventory",
  location: "inventory",
  binNumber: "inventory",
};

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

function BasicInfoStep({
  formData,
  setFormData,
  errors,
  categories,
  onCreateCategory,
}) {
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * THE NAME IS STORED BESIDE THE ID, for the review step.
   *
   * `category` is a uuid — it is what the form posts and what `addProductPg`
   * resolves. The review step renders `categoryName || category`, and nothing
   * ever set `categoryName`, so the last thing shown before submitting was a
   * row reading "Category  3f2a1c9e-…". A person cannot check an id against
   * what they meant, which is the entire job of a review step.
   */
  const handleCategoryChange = (id, selected) => {
    setFormData((prev) => ({
      ...prev,
      category: id,
      categoryName:
        selected?.name ??
        categories.find((c) => c._id === id)?.name ??
        "",
    }));
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
        onChange={handleCategoryChange}
        onCreate={onCreateCategory}
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

function PricingStep({ formData, setFormData, errors, mayCost, mayPrice }) {
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
        {mayCost && (
          <CostPriceField
            value={formData.costPrice}
            onChange={(v) => handleChange("costPrice", v)}
            error={errors?.costPrice?.[0]}
          />
        )}
        {mayPrice && (
          <SellingPriceField
            value={formData.sellingPrice}
            onChange={(v) => handleChange("sellingPrice", v)}
            error={errors?.sellingPrice?.[0]}
          />
        )}
      </div>

      {/* Segregation of duties: cost and price are set by different roles. */}
      {mayCost !== mayPrice && (
        <p className="text-xs text-muted-foreground">
          {mayCost
            ? "The selling price is set by Sales or Finance and stays at zero until they price it."
            : "The cost price is set by Finance or Procurement and stays at zero until they cost it."}
        </p>
      )}

      {/* Auto-calculated margins */}
      {mayCost && mayPrice && cost > 0 && selling > 0 && (
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

function ReviewStep({ formData, canEditPricing, mayCost, mayPrice }) {
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
            {mayCost && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cost Price</span>
              <span className="font-medium">
                KES {cost.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
              </span>
            </div>
            )}
            {mayPrice && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selling Price</span>
              <span className="font-medium">
                KES{" "}
                {selling.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
              </span>
            </div>
            )}
            {mayCost && mayPrice && cost > 0 && selling > 0 && (
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
                  {formData.costingMethod || "average"}
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
  categories: initialCategories = [],
}) {
  // The same rules the server applies (lib/permissions.js). This used to be
  // ["admin", "manager"]: it hid the step from SuperAdmin, CFO, Finance
  // Manager, Sales Manager and Procurement Officer, and showed it to Manager —
  // whose prices addProductPg then silently saved as zero.
  const mayCost = canSetProductCost(userRole);
  const mayPrice = canSetSellingPrice(userRole);
  const canEditPricing = mayCost || mayPrice;

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
    costingMethod: "average",
    location: "",
    binNumber: "",
    trackInventory: true,
    allowNegativeStock: false,
    isActive: true,
  });

  /**
   * THE LIST IS STATE, not the prop straight through.
   *
   * A category created from inside the wizard has to appear in the picker in
   * the same breath. The server page read the list once; re-reading it means a
   * navigation, and a navigation is the one thing the shortcut exists to
   * avoid.
   */
  const [categories, setCategories] = useState(initialCategories);
  // A prop change (the page re-rendering after a revalidate) still wins —
  // otherwise a category added on the category screen in another tab would
  // never reach a wizard left open.
  useEffect(() => {
    setCategories((prev) => {
      const seen = new Set(initialCategories.map((c) => c._id));
      // Anything created here that the server has not caught up with yet is
      // kept: dropping it would clear a field the user has already filled.
      const extra = prev.filter((c) => !seen.has(c._id));
      // Returning `prev` unchanged rather than an equal-but-new array, so the
      // first render after mount does not re-render the whole wizard for a
      // list that did not move.
      if (!extra.length && prev.length === initialCategories.length) return prev;
      return [...initialCategories, ...extra];
    });
  }, [initialCategories]);

  const handleCreateCategory = async (name) => {
    const res = await createCategoryQuickPg(name);
    if (!res?.success) return { error: res?.error || "Could not create that category." };
    setCategories((prev) =>
      prev.some((c) => c._id === res.category._id)
        ? prev
        : [...prev, { ...res.category, level: 0 }],
    );
    return res.category;
  };

  const router = useRouter();

  // Form action state
  // Errors are read directly from state in JSX
  const [state, formAction, isPending] = useActionState(addProductPg, null);

  /**
   * The Mongo action redirected from the server on success. The Postgres one
   * RETURNS a result instead, because a server action that redirects cannot
   * also report which product it made — and the wizard needs the id to send
   * the user to it. Navigation therefore happens here.
   */
  useEffect(() => {
    if (state?.success && state.productId) {
      router.push(
        `/dashboard/stocks?success=${encodeURIComponent(state.message ?? "Product created")}`,
      );
    }
  }, [state, router]);

  // Combine server errors with client validation errors
  const errors = state?.error || clientErrors;

  /**
   * A refusal moves the wizard to where the refusal can be read.
   *
   * Without this the message exists in `state.error` and is rendered by an
   * input three steps back that nobody is looking at. `_form` errors are left
   * alone — the banner above the card carries those, and the Review step is
   * the right place to be standing when you read one.
   */
  useEffect(() => {
    const serverError = state?.error;
    if (!serverError) return;
    const offending = Object.keys(serverError)
      .filter((field) => field !== "_form" && serverError[field]?.length)
      .map((field) => FIELD_STEP[field])
      .find(Boolean);
    if (!offending) return;
    const index = visibleSteps.findIndex((step) => step.id === offending);
    if (index >= 0) setCurrentStep(index);
    // visibleSteps is derived from the role and does not change within a
    // mounted wizard, so `state` alone is the trigger — one jump per refusal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
        if (mayCost && (!formData.costPrice || parseFloat(formData.costPrice) < 0)) {
          newErrors.costPrice = ["Valid cost price is required"];
        }
        if (mayPrice && (!formData.sellingPrice || parseFloat(formData.sellingPrice) < 0)) {
          newErrors.sellingPrice = ["Valid selling price is required"];
        }
        break;

      case "inventory":
        if (formData.trackInventory) {
          /**
           * OPENING STOCK NEEDS A COST, and the server has always said so —
           * silently, from the Review step, where no field error can render.
           *
           * Stock admitted at no value raises the quantity on the shelf while
           * the balance sheet stays still, and leaves units with nothing to
           * charge to cost of sales when they sell. It is the same rule 0117
           * enforces on a stock adjustment; here it is caught on the step that
           * owns the field, next to the box that caused it.
           */
          if (Number(formData.initialStock) > 0) {
            if (!mayCost) {
              newErrors.initialStock = [
                "Opening stock has to be valued, and you do not set cost " +
                  "prices. Save with zero stock and ask someone with cost " +
                  "rights to add it.",
              ];
            } else if (!(parseFloat(formData.costPrice) > 0)) {
              newErrors.initialStock = [
                "Opening stock needs a cost price. Set one on the Pricing " +
                  "step, or save with zero stock and receive it through a " +
                  "goods receipt.",
              ];
            }
          }

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
            onCreateCategory={handleCreateCategory}
          />
        );
      case "pricing":
        return (
          <PricingStep
            formData={formData}
            setFormData={setFormData}
            errors={errors}
            mayCost={mayCost}
            mayPrice={mayPrice}
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
          <ReviewStep
            formData={formData}
            canEditPricing={canEditPricing}
            mayCost={mayCost}
            mayPrice={mayPrice}
          />
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

      {/*
        EVERY server message, not just `_form`. The jump above puts the offending
        field on screen, and this says what happened in one place regardless —
        a field error that scrolled out of view was the whole failure mode.
      */}
      {state?.error && Object.keys(state.error).length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {Object.values(state.error)
              .flat()
              .filter(Boolean)
              .map((message, i) => (
                <span key={i} className="block">
                  {message}
                </span>
              ))}
          </AlertDescription>
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
