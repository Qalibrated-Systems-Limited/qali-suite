"use client";

import { useActionState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { escalateCheckout } from "@/app/mongodb/checkout-action";
import { AlertTriangle, Loader2 } from "lucide-react";

export function EscalateDialog({ checkout, open, onOpenChange }) {
  const [state, formAction, isPending] = useActionState(
    escalateCheckout.bind(null, checkout._id),
    {
      message: "",
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Escalate Checkout
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Escalate this overdue checkout to a manager
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-4 py-4">
            {/* Checkout Info */}
            <div className="space-y-2 p-3 bg-red-500/5 rounded-lg border border-red-500/20">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Product:</span>
                <span className="font-medium text-foreground">
                  {checkout.productSnapshot.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Checked Out To:</span>
                <span className="text-foreground">
                  {checkout.checkedOutTo.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Days Overdue:</span>
                <span className="text-red-500 font-medium">
                  {checkout.daysOverdue} days
                </span>
              </div>
            </div>

            {/* Escalate To Name */}
            <div className="space-y-2">
              <Label htmlFor="escalatedToName" className="text-muted-foreground">
                Escalate To (Name) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="escalatedToName"
                name="escalatedToName"
                placeholder="Manager name..."
                required
                className="bg-muted/50 border-border text-foreground placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
              />
            </div>

            {/* Escalate To ID */}
            <div className="space-y-2">
              <Label htmlFor="escalatedToId" className="text-muted-foreground">
                Escalate To (ID) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="escalatedToId"
                name="escalatedToId"
                placeholder="Manager ID..."
                required
                className="bg-muted/50 border-border text-foreground placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
              />
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason" className="text-muted-foreground">
                Escalation Reason
              </Label>
              <Textarea
                id="reason"
                name="reason"
                placeholder="Reason for escalation..."
                defaultValue={`Item is ${checkout.daysOverdue} days overdue`}
                className="bg-muted/50 border-border text-foreground placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500"
                rows={3}
              />
            </div>

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
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-red-500 text-foreground hover:bg-red-600"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Escalating...
                </>
              ) : (
                <>
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Escalate
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
