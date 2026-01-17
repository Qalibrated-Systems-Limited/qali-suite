"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Loader2,
  Send,
  DollarSign,
  MapPin,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import {
  createAdvanceRequest,
  updateClaim,
} from "@/app/mongodb/actions/claim-action";
import { toast } from "sonner";

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

export function AdvanceRequestForm({ claim = null }) {
  const router = useRouter();
  const isEdit = !!claim;

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

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Advance request submitted successfully", {
        description: `Request ${state.claimNumber} is now pending approval`,
      });
      router.push(`/dashboard/claims/${state.claimId}`);
    } else if (state?.errors?._form) {
      toast.error(state.errors._form[0]);
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

          {/* Info Banner */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-4 sm:p-5">
            <p className="text-sm sm:text-base text-blue-800 dark:text-blue-300">
              💡 <strong>Tip:</strong> Advance requests must be settled with
              receipts within 7 days after your return.
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
                  defaultValue={claim?.advanceDetails?.requestedAmount || ""}
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
                  defaultValue={claim?.advanceDetails?.purpose || ""}
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

          {/* Travel Details Section */}
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
                    required
                    placeholder="e.g., Mombasa"
                    defaultValue={claim?.advanceDetails?.destination || ""}
                    className="pl-11 h-12"
                  />
                </div>
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
                    required
                    min={today}
                    max={maxDateStr}
                    defaultValue={formatDateForInput(
                      claim?.advanceDetails?.travelDates?.from
                    )}
                    className="h-12"
                  />
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
                    required
                    min={today}
                    max={maxDateStr}
                    defaultValue={formatDateForInput(
                      claim?.advanceDetails?.travelDates?.to
                    )}
                    className="h-12"
                  />
                </div>
              </div>
            </div>
          </div>

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
              defaultValue={claim?.advanceDetails?.estimatedExpenses || ""}
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
              defaultValue={claim?.notes || ""}
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
              <Link href="/dashboard/claims/my-claims">Cancel</Link>
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
          <li>After your trip, submit receipts to settle the advance</li>
          <li>Any unused amount must be returned to the company</li>
        </ol>
      </Card>
    </div>
  );
}
