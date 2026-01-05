"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { returnCheckout } from "@/app/mongodb/checkout-action";
import { RotateCcw, Loader2 } from "lucide-react";
import { useActionState } from "react";

export function ReturnDialog({ checkout, open, onOpenChange }) {
  const [returnCondition, setReturnCondition] = useState("");
  const [state, formAction] = useActionState(
    returnCheckout.bind(null, checkout._id),
    {
      message: "",
    }
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (formData) => {
    setIsSubmitting(true);
    await formAction(formData);
    setIsSubmitting(false);

    if (state.message === "success") {
      onOpenChange(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-gray-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-green-500" />
            Process Return
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Process the return of this checked out item
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Item Info */}
            <div className="space-y-2 p-3 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Product:</span>
                <span className="font-medium text-white">
                  {checkout.productSnapshot.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Quantity:</span>
                <span className="text-gray-100">{checkout.quantity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Checked Out To:</span>
                <span className="text-gray-100">
                  {checkout.checkedOutTo.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Expected Return:</span>
                <span className="text-gray-100">
                  {formatDate(checkout.expectedReturnDate)}
                </span>
              </div>
              {checkout.isOverdue && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Days Overdue:</span>
                  <span className="text-red-500 font-medium">
                    {checkout.daysOverdue} days
                  </span>
                </div>
              )}
            </div>

            {/* Return Condition */}
            <div className="space-y-2">
              <Label htmlFor="returnCondition" className="text-gray-300">
                Return Condition <span className="text-red-500">*</span>
              </Label>
              <Select
                name="returnCondition"
                value={returnCondition}
                onValueChange={setReturnCondition}
                required
              >
                <SelectTrigger className="bg-[#0d1117] border-[#30363d] text-gray-100">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent className="bg-[#161b22] border-[#30363d]">
                  <SelectItem
                    value="excellent"
                    className="text-gray-100 focus:bg-[#1f2937]"
                  >
                    Excellent - Like new
                  </SelectItem>
                  <SelectItem
                    value="good"
                    className="text-gray-100 focus:bg-[#1f2937]"
                  >
                    Good - Normal wear
                  </SelectItem>
                  <SelectItem
                    value="fair"
                    className="text-gray-100 focus:bg-[#1f2937]"
                  >
                    Fair - Some wear
                  </SelectItem>
                  <SelectItem
                    value="poor"
                    className="text-gray-100 focus:bg-[#1f2937]"
                  >
                    Poor - Heavy wear
                  </SelectItem>
                  <SelectItem
                    value="damaged"
                    className="text-gray-100 focus:bg-[#1f2937]"
                  >
                    Damaged - Needs repair
                  </SelectItem>
                  <SelectItem
                    value="lost"
                    className="text-gray-100 focus:bg-[#1f2937]"
                  >
                    Lost - Not returned
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Return Notes */}
            <div className="space-y-2">
              <Label htmlFor="returnNotes" className="text-gray-300">
                Return Notes
              </Label>
              <Textarea
                id="returnNotes"
                name="returnNotes"
                placeholder="Any notes about the return..."
                className="bg-[#0d1117] border-[#30363d] text-gray-100 placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
                rows={3}
              />
            </div>

            {/* Damage Details (conditional) */}
            {(returnCondition === "damaged" || returnCondition === "lost") && (
              <div className="space-y-2">
                <Label htmlFor="damageDetails" className="text-gray-300">
                  {returnCondition === "lost"
                    ? "Loss Details"
                    : "Damage Details"}
                  <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="damageDetails"
                  name="damageDetails"
                  placeholder={`Describe the ${
                    returnCondition === "lost" ? "circumstances" : "damage"
                  }...`}
                  className="bg-[#0d1117] border-[#30363d] text-gray-100 placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
                  rows={3}
                  required
                />
              </div>
            )}

            {/* Error Message */}
            {state.message && state.message !== "success" && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-500">{state.message}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !returnCondition}
              className="bg-green-500 text-white hover:bg-green-600"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Process Return
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
