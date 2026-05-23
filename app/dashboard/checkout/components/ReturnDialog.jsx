"use client";

import { useState, useActionState, useEffect } from "react";
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

export function ReturnDialog({ checkout, open, onOpenChange }) {
  const [returnCondition, setReturnCondition] = useState("");
  const [state, formAction, isPending] = useActionState(
    returnCheckout.bind(null, checkout._id),
    { message: "" }
  );

  useEffect(() => {
    if (state.message === "success") {
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

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
      <DialogContent className="bg-background border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-green-500" />
            Process Return
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Process the return of this checked out item
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-4 py-4">
            {/* Item Info */}
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Product:</span>
                <span className="font-medium text-foreground">
                  {checkout.productSnapshot.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Quantity:</span>
                <span className="text-foreground">{checkout.quantity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Checked Out To:</span>
                <span className="text-foreground">
                  {checkout.checkedOutTo.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Expected Return:</span>
                <span className="text-foreground">
                  {formatDate(checkout.expectedReturnDate)}
                </span>
              </div>
              {checkout.isOverdue && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Days Overdue:</span>
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
                <SelectTrigger className="bg-muted/50 border-border text-foreground">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem
                    value="excellent"
                    className="text-foreground focus:bg-[#1f2937]"
                  >
                    Excellent - Like new
                  </SelectItem>
                  <SelectItem
                    value="good"
                    className="text-foreground focus:bg-[#1f2937]"
                  >
                    Good - Normal wear
                  </SelectItem>
                  <SelectItem
                    value="fair"
                    className="text-foreground focus:bg-[#1f2937]"
                  >
                    Fair - Some wear
                  </SelectItem>
                  <SelectItem
                    value="poor"
                    className="text-foreground focus:bg-[#1f2937]"
                  >
                    Poor - Heavy wear
                  </SelectItem>
                  <SelectItem
                    value="damaged"
                    className="text-foreground focus:bg-[#1f2937]"
                  >
                    Damaged - Needs repair
                  </SelectItem>
                  <SelectItem
                    value="lost"
                    className="text-foreground focus:bg-[#1f2937]"
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
                className="bg-muted/50 border-border text-foreground placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
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
                  className="bg-muted/50 border-border text-foreground placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
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
              disabled={isPending}
              className="border-border text-gray-300 hover:bg-[#1f2937] hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !returnCondition}
              className="bg-green-500 text-foreground hover:bg-green-600"
            >
              {isPending ? (
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
