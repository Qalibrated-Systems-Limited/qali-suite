"use client";

import { useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  IconCheck,
  IconX,
  IconAlertCircle,
  IconPackage,
} from "@tabler/icons-react";
import { useForm } from "react-hook-form";
import NextForm from "next/form";
import {
  approveRequest,
  rejectRequest,
  fulfillRequest,
  cancelRequest,
} from "@/app/mongodb/requests-actions";

// ============================================
// 1. APPROVE DIALOG
// ============================================
export function ApproveDialog({ request, open, onOpenChange }) {
  const initialState = { message: "" };
  const approveWithId = approveRequest.bind(null, request._id);
  const [state, dispatch, isPending] = useActionState(
    approveWithId,
    initialState
  );

  const form = useForm({
    defaultValues: {
      comments: "",
      conditions: "",
    },
  });

  // Close dialog on success
  if (state.message === "success" && open) {
    onOpenChange(false);
    window.location.reload();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconCheck className="h-5 w-5 text-green-500" />
            Approve Request
          </DialogTitle>
          <DialogDescription>
            Request #{request.requestNumber} - {request.requester.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Request Summary */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Department</p>
                  <p className="font-medium">{request.requester.department}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Items</p>
                  <p className="font-medium">{request.items.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Value</p>
                  <p className="font-semibold text-primary">
                    KES {request.totalValue.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Priority</p>
                  <Badge variant="outline">{request.priority}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Form */}
          <Form {...form}>
            <NextForm action={dispatch} className="space-y-4">
              <FormField
                control={form.control}
                name="comments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comments (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Add any comments or instructions..."
                        className="min-h-[80px]"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      These comments will be visible to the requester and
                      storekeeper
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="conditions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conditions (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Must return within 5 days"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {state.message && state.message !== "success" && (
                <Alert variant="destructive">
                  <AlertDescription>{state.message}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isPending ? "Approving..." : "Approve Request"}
                </Button>
              </DialogFooter>
            </NextForm>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// 2. REJECT DIALOG
// ============================================
export function RejectDialog({ request, open, onOpenChange }) {
  const initialState = { message: "" };
  const rejectWithId = rejectRequest.bind(null, request._id);
  const [state, dispatch, isPending] = useActionState(
    rejectWithId,
    initialState
  );

  const form = useForm({
    defaultValues: {
      reason: "",
    },
  });

  if (state.message === "success" && open) {
    onOpenChange(false);
    window.location.reload();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconX className="h-5 w-5 text-red-500" />
            Reject Request
          </DialogTitle>
          <DialogDescription>
            Request #{request.requestNumber}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <NextForm action={dispatch} className="space-y-4">
            <Alert>
              <IconAlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This action will notify the requester. Please provide a clear
                reason.
              </AlertDescription>
            </Alert>

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Rejection *</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Explain why this request is being rejected..."
                      className="min-h-[120px]"
                      required
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Minimum 10 characters required
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {state.message && state.message !== "success" && (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} variant="destructive">
                {isPending ? "Rejecting..." : "Reject Request"}
              </Button>
            </DialogFooter>
          </NextForm>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// 3. FULFILL DIALOG (Full Page/Large Dialog)
// ============================================
export function FulfillDialog({ request, open, onOpenChange }) {
  const initialState = { message: "" };
  const fulfillWithId = fulfillRequest.bind(null, request._id);
  const [state, dispatch, isPending] = useActionState(
    fulfillWithId,
    initialState
  );

  const [itemQuantities, setItemQuantities] = useState({});

  const form = useForm({
    defaultValues: {
      comments: "",
    },
  });

  if (state.message === "success" && open) {
    onOpenChange(false);
    window.location.reload();
  }

  const handleQuantityChange = (itemId, value, maxQuantity) => {
    const qty = parseInt(value) || 0;
    setItemQuantities((prev) => ({
      ...prev,
      [itemId]: Math.min(Math.max(0, qty), maxQuantity),
    }));
  };

  const totalFulfilled = Object.values(itemQuantities).reduce(
    (sum, qty) => sum + (qty || 0),
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPackage className="h-5 w-5 text-primary" />
            Fulfill Request
          </DialogTitle>
          <DialogDescription>
            Request #{request.requestNumber} - {request.requester.name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <NextForm action={dispatch} className="space-y-6">
            {/* Instructions */}
            <Alert>
              <IconAlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Enter the quantity you can provide for each item. You can
                fulfill partially if there's insufficient stock.
              </AlertDescription>
            </Alert>

            {/* Items List */}
            <div className="space-y-3">
              <h4 className="font-semibold">Items to Fulfill</h4>

              {request.items.map((item) => (
                <Card key={item._id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Item Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            SKU: {item.SKU} • Purpose: {item.purpose}
                          </p>
                          {item.requiresReturn && (
                            <Badge variant="outline" className="mt-1 text-xs">
                              Must be returned
                            </Badge>
                          )}
                        </div>
                        <Badge variant="secondary">
                          Requested: {item.requestedQuantity}
                        </Badge>
                      </div>

                      {/* Quantity Input */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-muted-foreground">
                            Quantity to Fulfill *
                          </label>
                          <Input
                            type="number"
                            name={`item_${item._id}`}
                            min="0"
                            max={item.requestedQuantity}
                            value={itemQuantities[item._id] || ""}
                            onChange={(e) =>
                              handleQuantityChange(
                                item._id,
                                e.target.value,
                                item.requestedQuantity
                              )
                            }
                            placeholder="0"
                            className="mt-1"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Max: {item.requestedQuantity} • Current Stock:{" "}
                            {item.currentStock}
                          </p>
                        </div>

                        {item.requiresReturn && (
                          <div className="md:col-span-2">
                            <label className="text-xs text-muted-foreground">
                              Serial Number (Optional)
                            </label>
                            <Input
                              type="text"
                              name={`serialNo_${item._id}`}
                              placeholder="Enter serial number if applicable"
                              className="mt-1"
                            />
                          </div>
                        )}
                      </div>

                      {/* Quick Actions */}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleQuantityChange(
                              item._id,
                              item.requestedQuantity,
                              item.requestedQuantity
                            )
                          }
                        >
                          Fulfill All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleQuantityChange(
                              item._id,
                              Math.floor(item.requestedQuantity / 2),
                              item.requestedQuantity
                            )
                          }
                        >
                          Fulfill Half
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleQuantityChange(
                              item._id,
                              0,
                              item.requestedQuantity
                            )
                          }
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Comments */}
            <FormField
              control={form.control}
              name="comments"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comments (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Add any notes about the fulfillment..."
                      className="min-h-[80px]"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Summary */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Total Items to Fulfill:</span>
                  <Badge variant="default" className="text-base px-3 py-1">
                    {totalFulfilled} of{" "}
                    {request.items.reduce(
                      (sum, item) => sum + item.requestedQuantity,
                      0
                    )}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {state.message && state.message !== "success" && (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || totalFulfilled === 0}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isPending ? "Processing..." : "Fulfill Request"}
              </Button>
            </DialogFooter>
          </NextForm>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// 4. CANCEL DIALOG
// ============================================
export function CancelDialog({ request, open, onOpenChange }) {
  const initialState = { message: "" };
  const cancelWithId = cancelRequest.bind(null, request._id);
  const [state, dispatch, isPending] = useActionState(
    cancelWithId,
    initialState
  );

  const form = useForm({
    defaultValues: {
      reason: "",
    },
  });

  if (state.message === "success" && open) {
    onOpenChange(false);
    window.location.reload();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Request</DialogTitle>
          <DialogDescription>
            Request #{request.requestNumber}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <NextForm action={dispatch} className="space-y-4">
            <Alert>
              <IconAlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This action cannot be undone. The request will be marked as
                cancelled.
              </AlertDescription>
            </Alert>

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Cancellation *</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Explain why you're cancelling this request..."
                      className="min-h-[100px]"
                      required
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Minimum 10 characters required
                  </FormDescription>
                </FormItem>
              )}
            />

            {state.message && state.message !== "success" && (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Go Back
              </Button>
              <Button type="submit" disabled={isPending} variant="destructive">
                {isPending ? "Cancelling..." : "Cancel Request"}
              </Button>
            </DialogFooter>
          </NextForm>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
