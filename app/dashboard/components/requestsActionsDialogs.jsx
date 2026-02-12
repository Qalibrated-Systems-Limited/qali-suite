"use client";

import { useState, useActionState, useTransition } from "react";
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
import { useEffect } from "react";
import { IconClock } from "@tabler/icons-react";
import { Progress } from "@/components/ui/progress";

// ============================================
// 1. APPROVE DIALOG
// ============================================
function initialiseQty(request, open) {
  const initialQty = {};
  if (request && open) {
    request.items.forEach((item) => {
      initialQty[item._id] = item.requestedQuantity;
    });
  }
  return initialQty;
}

export function ApproveDialog({ request, open, onOpenChange }) {
  const initialState = { message: "" };
  const approveWithId = approveRequest.bind(null, request._id);
  const [state, dispatch] = useActionState(approveWithId, initialState);
  const [isPending, startTransition] = useTransition();

  // Track approved quantities for each item
  const [approvedQuantities, setApprovedQuantities] = useState(() =>
    initialiseQty(request, open)
  );
  const [itemNotes, setItemNotes] = useState({});
  const [comments, setComments] = useState("");
  const [conditions, setConditions] = useState("");

  const handleQuantityChange = (itemId, value, maxQuantity) => {
    const qty = parseInt(value) || 0;
    setApprovedQuantities((prev) => ({
      ...prev,
      [itemId]: Math.min(Math.max(0, qty), maxQuantity),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append("comments", comments);
    formData.append("conditions", conditions);

    // ✅ Add approved quantities for each item
    request.items.forEach((item) => {
      const approvedQty =
        approvedQuantities[item._id] || item.requestedQuantity;
      formData.append(`approved_${item._id}`, approvedQty);
      if (itemNotes[item._id]) {
        formData.append(`notes_${item._id}`, itemNotes[item._id]);
      }
    });

    startTransition(() => {
      dispatch(formData);
    });
  };

  const totalRequested = request.items.reduce(
    (sum, item) => sum + item.requestedQuantity,
    0
  );
  const totalApproving = Object.values(approvedQuantities).reduce(
    (sum, qty) => sum + (qty || 0),
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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

          {/* ✅ NEW: Item-by-item approval */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Approve Items</h4>
              <Alert className="w-auto">
                <IconAlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  You can adjust quantities per item
                </AlertDescription>
              </Alert>
            </div>

            {request.items.map((item) => (
              <Card key={item._id}>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* Item Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          SKU: {item.SKU} • Stock: {item.currentStock}{" "}
                          {item.unit}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        Requested: {item.requestedQuantity}
                      </Badge>
                    </div>

                    {/* Approval Quantity */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium">
                          Approve Quantity *
                        </label>
                        <Input
                          type="number"
                          min="0"
                          max={item.requestedQuantity}
                          value={
                            approvedQuantities[item._id] ||
                            item.requestedQuantity
                          }
                          onChange={(e) =>
                            handleQuantityChange(
                              item._id,
                              e.target.value,
                              item.requestedQuantity
                            )
                          }
                          className="mt-1"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Requested: {item.requestedQuantity} • Stock:{" "}
                          {item.currentStock}
                        </p>
                      </div>

                      <div>
                        <label className="text-xs font-medium">
                          Item Notes (Optional)
                        </label>
                        <Input
                          type="text"
                          value={itemNotes[item._id] || ""}
                          onChange={(e) =>
                            setItemNotes({
                              ...itemNotes,
                              [item._id]: e.target.value,
                            })
                          }
                          placeholder="e.g., 2 units out of stock"
                          className="mt-1"
                        />
                      </div>
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
                        Approve All
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleQuantityChange(
                            item._id,
                            Math.min(item.currentStock, item.requestedQuantity),
                            item.requestedQuantity
                          )
                        }
                      >
                        Approve Stock Available (
                        {Math.min(item.currentStock, item.requestedQuantity)})
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
                        Deny
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Summary */}
          <Card className="bg-green-500/10 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Total Approving:</span>
                <Badge
                  variant="default"
                  className="bg-green-600 text-base px-3 py-1"
                >
                  {totalApproving} of {totalRequested} units
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Comments (Optional)</label>
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Add any comments or instructions..."
                className="min-h-20"
              />
              <p className="text-xs text-muted-foreground">
                These comments will be visible to the requester and storekeeper
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Conditions (Optional)
              </label>
              <Input
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                placeholder="e.g., Must return within 5 days"
              />
            </div>

            {state.message && state.message !== "success" && (
              <Alert variant="destructive">
                <IconAlertCircle className="h-4 w-4" />
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
                disabled={isPending || totalApproving === 0}
                className="bg-green-600 hover:bg-green-700"
              >
                {isPending ? "Approving..." : `Approve ${totalApproving} Items`}
              </Button>
            </DialogFooter>
          </form>
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
  const [, startTransition] = useTransition();

  const [itemQuantities, setItemQuantities] = useState({});
  const [serialNumbers, setSerialNumbers] = useState({});

  const form = useForm({
    defaultValues: {
      comments: "",
    },
  });

  // Initialize quantities when dialog opens
  useEffect(() => {
    if (open && request) {
      const initialQty = {};
      request.items.forEach((item) => {
        // ✅ FIXED: Use remainingToFulfill instead of requestedQuantity
        const remaining =
          item.remainingToFulfill ||
          (item.approvedQuantity || item.requestedQuantity) -
            (item.totalFulfilled || 0);
        initialQty[item._id] = 0; // Start with 0, user enters what they want
      });
      setItemQuantities(initialQty);
      setSerialNumbers({});
    }
  }, [open, request]);

  const handleQuantityChange = (itemId, value, maxQuantity) => {
    const qty = parseInt(value) || 0;
    setItemQuantities((prev) => ({
      ...prev,
      [itemId]: Math.min(Math.max(0, qty), maxQuantity),
    }));
  };

  const totalFulfilling = Object.values(itemQuantities).reduce(
    (sum, qty) => sum + (qty || 0),
    0
  );

  // ✅ Calculate fulfillment progress for each item
  const getItemProgress = (item) => {
    const target = item.approvedQuantity || item.requestedQuantity;
    const fulfilled = item.totalFulfilled || 0;
    if (target === 0) return 0;
    return Math.round((fulfilled / target) * 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPackage className="h-5 w-5 text-yellow-500" />
            Fulfill Request
          </DialogTitle>
          <DialogDescription>
            Request #{request.requestNumber} - {request.requester.name}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(() => {
              dispatch(new FormData(e.target));
            });
          }}
          className="space-y-6"
        >
          {/* Instructions */}
          <Alert>
            <IconAlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              ✅ You can fulfill <strong>partial quantities</strong>. Enter only
              what's available now. Remaining items can be fulfilled later.
            </AlertDescription>
          </Alert>

          {/* Items List */}
          <div className="space-y-3">
            <h4 className="font-semibold">Items to Fulfill</h4>

            {request.items.map((item) => {
              // ✅ FIXED: Calculate remaining properly
              const target = item.approvedQuantity || item.requestedQuantity;
              const fulfilled = item.totalFulfilled || 0;
              const remaining = item.remainingToFulfill || target - fulfilled;
              const progress = getItemProgress(item);
              const isComplete = remaining === 0;

              return (
                <Card
                  key={item._id}
                  className={`overflow-hidden ${
                    isComplete ? "bg-muted/50 opacity-60" : ""
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Item Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            SKU: {item.SKU} • Type: {request.requestType?.replace(/_/g, " ")}
                          </p>
                          {item.requiresReturn && (
                            <Badge variant="outline" className="mt-1 text-xs">
                              Must be returned
                            </Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <Badge variant={isComplete ? "success" : "secondary"}>
                            {isComplete ? (
                              <>
                                <IconCheck className="mr-1 h-3 w-3" />
                                Complete
                              </>
                            ) : (
                              <>
                                <IconClock className="mr-1 h-3 w-3" />
                                {remaining} remaining
                              </>
                            )}
                          </Badge>
                        </div>
                      </div>

                      {/* ✅ FIXED: Show fulfillment progress */}
                      {!isComplete && fulfilled > 0 && (
                        <div className="space-y-1 p-3 bg-muted/50 rounded-md">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              Previously Fulfilled: {fulfilled} of {target}
                            </span>
                            <span>{progress}%</span>
                          </div>
                          <Progress value={progress} className="h-2" />
                          {item.fulfillments &&
                            item.fulfillments.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground">
                                  Fulfillment History:
                                </p>
                                {item.fulfillments.map((f, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span>
                                      <IconCheck className="inline h-3 w-3 mr-1 text-green-600" />
                                      {f.quantity} units
                                    </span>
                                    <span className="text-muted-foreground">
                                      {new Date(
                                        f.fulfilledAt
                                      ).toLocaleDateString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                        </div>
                      )}

                      {/* ✅ FIXED: Only show input if not complete */}
                      {!isComplete ? (
                        <>
                          {/* Quantity Input */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="text-xs font-medium">
                                Quantity to Fulfill Now *
                              </label>
                              <Input
                                type="number"
                                name={`item_${item._id}`}
                                min="0"
                                max={remaining} // ✅ FIXED: Use remaining, not requestedQuantity
                                value={itemQuantities[item._id] || ""}
                                onChange={(e) =>
                                  handleQuantityChange(
                                    item._id,
                                    e.target.value,
                                    remaining // ✅ FIXED
                                  )
                                }
                                placeholder="0"
                                className="mt-1"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Max: <strong>{remaining}</strong> remaining •
                                Stock: {item.currentStock}
                              </p>
                            </div>

                            {(item.requiresReturn ||
                              request.requestType !== "sale") && (
                              <div className="md:col-span-2">
                                <label className="text-xs font-medium">
                                  Serial Numbers (Optional, comma-separated)
                                </label>
                                <Input
                                  type="text"
                                  name={`serialNo_${item._id}`}
                                  value={serialNumbers[item._id] || ""}
                                  onChange={(e) =>
                                    setSerialNumbers({
                                      ...serialNumbers,
                                      [item._id]: e.target.value,
                                    })
                                  }
                                  placeholder="SN001, SN002, SN003"
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
                                  remaining, // ✅ FIXED: Use remaining
                                  remaining
                                )
                              }
                            >
                              Fulfill All ({remaining})
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleQuantityChange(
                                  item._id,
                                  Math.floor(remaining / 2), // ✅ FIXED
                                  remaining
                                )
                              }
                            >
                              Fulfill Half ({Math.floor(remaining / 2)})
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleQuantityChange(item._id, 0, remaining)
                              }
                            >
                              Clear
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-md p-3 text-center">
                          <IconCheck className="h-5 w-5 text-green-600 mx-auto mb-1" />
                          <p className="text-sm text-green-600 font-medium">
                            This item has been fully fulfilled
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Comments */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Fulfillment Notes</label>
            <Textarea
              name="comments"
              placeholder="Add any notes about this fulfillment..."
              className="min-h-[80px]"
            />
          </div>

          {/* Summary */}
          <Card className="bg-yellow-500/10 border-yellow-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  Total Items Fulfilling Now:
                </span>
                <Badge
                  variant="default"
                  className="bg-yellow-500 text-black text-base px-3 py-1"
                >
                  {totalFulfilling} units
                </Badge>
              </div>
            </CardContent>
          </Card>

          {state.message && state.message !== "success" && (
            <Alert variant="destructive">
              <IconAlertCircle className="h-4 w-4" />
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
              disabled={isPending || totalFulfilling === 0}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {isPending
                ? "Processing..."
                : `Fulfill ${totalFulfilling} Item(s)`}
            </Button>
          </DialogFooter>
        </form>
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
