"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
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
import {
  ArrowLeft,
  Loader2,
  Send,
  DollarSign,
  MapPin,
  Calendar,
  Briefcase,
  FolderKanban,
  Wallet,
  Building2,
} from "lucide-react";
import Link from "next/link";
import {
  createAdvanceRequest,
  updateClaim,
} from "@/app/mongodb/actions/claim-action";
import { toast } from "sonner";
import { ADVANCE_TYPES } from "@/lib/utils";
import ProjectPicker from "@/components/project-picker";

function SubmitButton({ isEdit, pending }) {
  return (
    <Button
      type="submit"
      disabled={pending}
      className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold h-12 text-base"
    >
      {pending ? (
        <>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          {isEdit ? "Updating..." : "Submitting..."}
        </>
      ) : (
        <>
          <Send className="w-5 h-5 mr-2" />
          {isEdit ? "Update Request" : "Submit Request"}
        </>
      )}
    </Button>
  );
}

// Helper function to get icon for advance type
function getAdvanceTypeIcon(type) {
  switch (type) {
    case "travel":
      return <MapPin className="w-4 h-4" />;
    case "petty_cash":
      return <Wallet className="w-4 h-4" />;
    case "operational":
      return <Building2 className="w-4 h-4" />;
    default:
      return <Briefcase className="w-4 h-4" />;
  }
}

// Helper function to get tip text based on advance type
function getAdvanceTip(type) {
  switch (type) {
    case "travel":
      return "Travel advances must be settled with receipts within 7 days after your return.";
    case "petty_cash":
      return "Petty cash advances are for small recurring office expenses. Keep all receipts for reconciliation.";
    case "operational":
      return "Operational advances are for general business expenses. Submit receipts within 14 days.";
    default:
      return "Advances must be settled with receipts after use.";
  }
}

export function AdvanceRequestForm({
  claim = null,
  projects = [],
  onBehalfOptions = [],
  currentUserId = "",
}) {
  const router = useRouter();
  const isEdit = !!claim;

  // Track selected advance type
  const [advanceType, setAdvanceType] = useState(
    claim?.advanceDetails?.advanceType || "travel"
  );

  // Project selection (optional for all advance types)
  const [projectId, setProjectId] = useState(claim?.projectId || "");

  // Use different action based on mode
  const action = isEdit
    ? updateClaim.bind(null, claim._id)
    : createAdvanceRequest;

  // CRITICAL: useActionState initial state must be null, not an object!
  const [state, formAction, pending] = useActionState(action, null);

  // Calculate minimum and maximum dates
  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 3); // Max 3 months in future
  const maxDateStr = maxDate.toISOString().split("T")[0];

  // Format dates for input fields
  const formatDateForInput = (date) => {
    if (!date) return "";
    return new Date(date).toISOString().split("T")[0];
  };

  // Update advanceType from state if validation failed
  useEffect(() => {
    if (state?.values?.advanceType) {
      setAdvanceType(state.values.advanceType);
    }
  }, [state?.values?.advanceType]);

  useEffect(() => {
    console.log("Form state changed:", state);
    if (state?.success) {
      toast.success(state.message || "Advance request submitted successfully", {
        description: `Request ${state.claimNumber} is now pending approval`,
      });
      router.push(`/dashboard/claims/${state.claimId}`);
    } else if (state?.errors) {
      // Show form-level errors
      if (state.errors._form) {
        toast.error(state.errors._form[0]);
      }
      // Show field-level errors as a summary toast
      const fieldErrors = Object.entries(state.errors)
        .filter(([key]) => key !== "_form")
        .map(([key, msgs]) => `${key}: ${msgs[0]}`)
        .join(", ");
      if (fieldErrors) {
        toast.error("Please fix the following errors", {
          description: fieldErrors,
        });
      }
    }
  }, [state, router]);

  return (
    <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="hover:bg-accent shrink-0"
        >
          <Link
            href={
              isEdit ? `/dashboard/claims/${claim._id}` : "/dashboard/my-claims"
            }
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground truncate">
            {isEdit ? `Edit ${claim.claimNumber}` : "New Advance Request"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {isEdit
              ? "Update your advance request details"
              : "Request an advance for business expenses"}
          </p>
        </div>
      </div>

      {/* Form */}
      <form action={formAction}>
        <Card className="p-5 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
          {/* General Error */}
          {state?.errors?._form && (
            <div className="p-4 sm:p-5 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm sm:text-base text-red-800 dark:text-red-300 font-medium">
                {state.errors._form[0]}
              </p>
            </div>
          )}

          {/* On behalf of — finance roles only (the page sends options only
              to them). Captures advances that used to be handed out manually
              and bypass the books. */}
          {!isEdit && onBehalfOptions.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Recording for</label>
              <select
                name="onBehalfUserId"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Myself</option>
                {onBehalfOptions
                  .filter((u) => u._id !== currentUserId)
                  .map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name} — {u.role}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Pick an employee to record an advance on their behalf — it
                posts to Employee Advances (recoverable) under their name,
                and they settle it with receipts like any other advance.
              </p>
            </div>
          )}

          {/* Advance Type Selector */}
          <div className="space-y-3">
            <Label htmlFor="advanceType" className="text-sm sm:text-base font-medium">
              Advance Type <span className="text-red-500">*</span>
            </Label>
            {/* Hidden input to submit the value with the form */}
            <input type="hidden" name="advanceType" value={advanceType} />
            <Select
              value={advanceType}
              onValueChange={setAdvanceType}
            >
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Select advance type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ADVANCE_TYPES).map(([value, { label, description }]) => (
                  <SelectItem key={value} value={value}>
                    <div className="flex items-center gap-2">
                      {getAdvanceTypeIcon(value)}
                      <div>
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground ml-2 text-sm">
                          - {description}
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state?.errors?.advanceType && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {state.errors.advanceType[0]}
              </p>
            )}
          </div>

          {/* Info Banner - Dynamic based on type */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-4 sm:p-5">
            <p className="text-sm sm:text-base text-blue-800 dark:text-blue-300">
              💡 <strong>Tip:</strong> {getAdvanceTip(advanceType)}
            </p>
          </div>

          {/* Amount Section */}
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-foreground">
              <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
              <h3 className="text-base sm:text-lg font-semibold">
                Amount & Purpose
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-5">
              {/* Requested Amount */}
              <div className="space-y-2.5">
                <Label
                  htmlFor="requestedAmount"
                  className="text-sm sm:text-base font-medium"
                >
                  Requested Amount (KES) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="requestedAmount"
                  name="requestedAmount"
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder="e.g., 20000"
                  defaultValue={state?.values?.requestedAmount ?? claim?.advanceDetails?.requestedAmount ?? ""}
                  key={`amount-${state?.values?.requestedAmount ?? "init"}`}
                  className="text-xl sm:text-2xl font-bold h-14 sm:h-16"
                />
                {state?.errors?.requestedAmount && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {state.errors.requestedAmount[0]}
                  </p>
                )}
              </div>

              {/* Purpose */}
              <div className="space-y-2.5">
                <Label
                  htmlFor="purpose"
                  className="text-sm sm:text-base font-medium"
                >
                  Purpose <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="purpose"
                  name="purpose"
                  type="text"
                  required
                  minLength={10}
                  placeholder="e.g., Client support visit to Mombasa"
                  defaultValue={state?.values?.purpose ?? claim?.advanceDetails?.purpose ?? ""}
                  key={`purpose-${state?.values?.purpose ?? "init"}`}
                  className="h-12"
                />
                {state?.errors?.purpose && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {state.errors.purpose[0]}
                  </p>
                )}
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Minimum 10 characters - be specific about the purpose
                </p>
              </div>
            </div>
          </div>

          {/* Travel Details Section - Only for travel type */}
          {advanceType === "travel" && (
            <div className="space-y-5 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-foreground">
                <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
                <h3 className="text-base sm:text-lg font-semibold">
                  Travel Details
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-5">
                {/* Destination */}
                <div className="space-y-2.5">
                  <Label
                    htmlFor="destination"
                    className="text-sm sm:text-base font-medium"
                  >
                    Destination <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="destination"
                      name="destination"
                      type="text"
                      placeholder="e.g., Mombasa"
                      defaultValue={state?.values?.destination ?? claim?.advanceDetails?.destination ?? ""}
                      key={`dest-${state?.values?.destination ?? "init"}`}
                      className="pl-11 h-12"
                    />
                  </div>
                  {state?.errors?.destination && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {state.errors.destination[0]}
                    </p>
                  )}
                </div>

                {/* Travel Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                  {/* Travel Start Date */}
                  <div className="space-y-2.5">
                    <Label
                      htmlFor="travelFromDate"
                      className="text-sm sm:text-base font-medium"
                    >
                      Travel Start Date <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="travelFromDate"
                      name="travelFromDate"
                      type="date"
                      min={today}
                      max={maxDateStr}
                      defaultValue={state?.values?.travelFromDate ?? formatDateForInput(claim?.advanceDetails?.travelDates?.from)}
                      key={`from-${state?.values?.travelFromDate ?? "init"}`}
                      className="h-12"
                    />
                    {state?.errors?.travelFromDate && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {state.errors.travelFromDate[0]}
                      </p>
                    )}
                  </div>

                  {/* Travel End Date */}
                  <div className="space-y-2.5">
                    <Label
                      htmlFor="travelToDate"
                      className="text-sm sm:text-base font-medium"
                    >
                      Travel End Date <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="travelToDate"
                      name="travelToDate"
                      type="date"
                      min={today}
                      max={maxDateStr}
                      defaultValue={state?.values?.travelToDate ?? formatDateForInput(claim?.advanceDetails?.travelDates?.to)}
                      key={`to-${state?.values?.travelToDate ?? "init"}`}
                      className="h-12"
                    />
                    {state?.errors?.travelToDate && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {state.errors.travelToDate[0]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Project Selection - Available for all advance types (optional) */}
          {projects.length > 0 && (
            <div className="space-y-5 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-foreground">
                <FolderKanban className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
                <h3 className="text-base sm:text-lg font-semibold">
                  Project
                </h3>
                <span className="text-xs text-muted-foreground">(optional)</span>
              </div>

              <div className="space-y-2.5">
                <Label className="text-sm sm:text-base font-medium">
                  Link to Project
                </Label>
                <input type="hidden" name="projectId" value={projectId} />
                <ProjectPicker
                  value={projectId}
                  onValueChange={setProjectId}
                  projects={projects}
                  placeholder="Select a project..."
                />
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Link this advance to a project for budget tracking
                </p>
              </div>
            </div>
          )}

          {/* Estimated Expenses Section */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div>
              <Label htmlFor="estimatedExpenses">
                Estimated Breakdown (Optional)
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Provide an estimate of how you'll use the advance
              </p>
            </div>

            <Textarea
              id="estimatedExpenses"
              name="estimatedExpenses"
              rows={4}
              placeholder="e.g.,&#10;- Transport: KES 8,000&#10;- Accommodation: KES 6,000&#10;- Meals: KES 4,000&#10;- Miscellaneous: KES 2,000"
              defaultValue={state?.values?.estimatedExpenses ?? claim?.advanceDetails?.estimatedExpenses ?? ""}
              key={`expenses-${state?.values?.estimatedExpenses ?? "init"}`}
              className="font-mono text-sm resize-none"
            />
          </div>

          {/* Additional Notes */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div>
              <Label htmlFor="notes">Additional Notes (Optional)</Label>
            </div>

            <Textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Any additional information for your manager..."
              defaultValue={state?.values?.notes ?? claim?.notes ?? ""}
              key={`notes-${state?.values?.notes ?? "init"}`}
              className="resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4 justify-end pt-6 border-t border-border">
            <Button
              type="button"
              variant="outline"
              asChild
              className="h-12 text-base font-medium"
            >
              <Link href="/dashboard/my-claims">Cancel</Link>
            </Button>
            <SubmitButton isEdit={isEdit} pending={pending} />
          </div>
        </Card>
      </form>

      {/* Help Card */}
      <Card className="p-5 sm:p-6 bg-muted/50">
        <h4 className="font-semibold text-sm sm:text-base mb-3">
          📋 What happens next?
        </h4>
        <ol className="text-sm sm:text-base text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Your manager will review and approve/reject your request</li>
          <li>If approved, the accountant will process the payment</li>
          <li>
            {advanceType === "travel"
              ? "After your trip, submit receipts to settle the advance"
              : "Submit receipts to settle the advance after use"}
          </li>
          <li>Any unused amount must be returned to the company</li>
        </ol>
      </Card>
    </div>
  );
}
