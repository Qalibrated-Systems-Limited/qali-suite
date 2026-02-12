"use client";

import { useActionState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "../../../components/ui/form";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import NextForm from "next/form";

import { IconClipboardList } from "@tabler/icons-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createRequestFromCartSchema } from "@/app/mongodb/validators";
import { departments, stockRequestTypes, stockRequestTypeConfig } from "@/lib/utils";
import { createRequestFromCart } from "@/app/mongodb/actions";
import { IconAlertCircle } from "@tabler/icons-react";

export function CreateRequestFromCartForm({
  customers = [],
  cartItems = [],
  cartTotal = 0,
}) {
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(
    createRequestFromCart,
    initialState
  );

  const form = useForm({
    resolver: zodResolver(createRequestFromCartSchema),
    defaultValues: {
      customer: "",
      requestType: "sale",
      priority: "normal",
      department: "",
      notes: "",
      requiredByDate: "",
    },
  });

  // Use stockRequestTypes from lib/utils (industry standard types)
  const requestTypeOptions = stockRequestTypes.map((type) => ({
    value: type,
    label: stockRequestTypeConfig[type]?.label || type,
  }));

  const priorityOptions = [
    { value: "low", label: "Low", color: "text-gray-500" },
    { value: "normal", label: "Normal", color: "text-blue-500" },
    { value: "high", label: "High", color: "text-orange-500" },
    { value: "urgent", label: "Urgent", color: "text-red-500" },
  ];

  const departmentOptions = departments;

  return (
    <div className="space-y-4">
      {/* Cart Summary */}
      <div className="rounded-lg border bg-muted/50 p-4">
        <div className="flex items-start gap-3">
          <IconClipboardList className="h-5 w-5 text-primary mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">Request Summary</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {cartItems.length} item(s) • Total value: KES{" "}
              {cartTotal.toLocaleString()}
            </p>
            <div className="mt-2 space-y-1">
              {cartItems.slice(0, 3).map((item, idx) => (
                <p key={idx} className="text-xs text-muted-foreground">
                  • {item.name} (Qty: {item.quantity})
                </p>
              ))}
              {cartItems.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  • And {cartItems.length - 3} more item(s)...
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Alert */}
      <Alert>
        <IconAlertCircle className="h-4 w-4" />
        <AlertDescription className="text-xs">
          This request will be sent for manager approval before items can be
          dispatched.
        </AlertDescription>
      </Alert>

      {/* Form */}
      <Form {...form}>
        <NextForm action={dispatch} className="space-y-4">
          {/* Customer Selection */}
          <FormField
            control={form.control}
            name="customer"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm">Customer *</FormLabel>
                <Select onValueChange={field.onChange} name="customer">
                  <FormControl>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectGroup>
                      {customers.map((customer) => (
                        <SelectItem key={customer._id} value={customer._id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
                {state.errors?.customer && (
                  <p className="text-xs text-destructive">
                    {state.errors.customer[0]}
                  </p>
                )}
              </FormItem>
            )}
          />

          {/* Department */}
          <FormField
            control={form.control}
            name="department"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm">Your Department *</FormLabel>
                <Select onValueChange={field.onChange} name="department">
                  <FormControl>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select your department" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectGroup>
                      {departmentOptions.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
                {state.errors?.department && (
                  <p className="text-xs text-destructive">
                    {state.errors.department[0]}
                  </p>
                )}
              </FormItem>
            )}
          />

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Request Type */}
            <FormField
              control={form.control}
              name="requestType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm">Request Type *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    name="requestType"
                    defaultValue="sale"
                  >
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select request type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        {requestTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  {state.errors?.requestType && (
                    <p className="text-xs text-destructive">
                      {state.errors.requestType[0]}
                    </p>
                  )}
                </FormItem>
              )}
            />

            {/* Priority */}
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm">Priority *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    name="priority"
                    defaultValue="normal"
                  >
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select priority" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        {priorityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span className={option.color}>{option.label}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  {state.errors?.priority && (
                    <p className="text-xs text-destructive">
                      {state.errors.priority[0]}
                    </p>
                  )}
                </FormItem>
              )}
            />
          </div>

          {/* Required By Date */}
          <FormField
            control={form.control}
            name="requiredByDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm">
                  Required By Date (Optional)
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    className="h-10"
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  When do you need these items?
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Notes */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm">Justification/Notes *</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder="Explain why you need these items. This will help with approval..."
                    className="min-h-[100px] resize-none"
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  Minimum 10 characters. Provide clear justification for manager
                  approval.
                </FormDescription>
                <FormMessage />
                {state.errors?.notes && (
                  <p className="text-xs text-destructive">
                    {state.errors.notes[0]}
                  </p>
                )}
              </FormItem>
            )}
          />

          {/* Error Message */}
          {state.message && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">
                {state.message}
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex gap-2 pt-2">
            <Button
              disabled={isPending || cartItems.length === 0}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isPending ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Submitting Request...
                </>
              ) : (
                <>
                  <IconClipboardList className="mr-2 h-4 w-4" />
                  Submit Request for Approval
                </>
              )}
            </Button>
          </div>

          {cartItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Your cart is empty. Add items before creating a request.
            </p>
          )}
        </NextForm>
      </Form>
    </div>
  );
}
