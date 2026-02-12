"use client";

import {
  addToCart,
  increaseQTY,
  decreaseQTY,
  removeCartItem,
} from "../../mongodb/actions";

import { Button } from "../../../components/ui/button";
import NextForm from "next/form";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "../../../components/ui/form";

import { Input } from "../../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useActionState, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cartItemForm } from "../../mongodb/validators";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

// ============================================
// IMPROVED ADD TO CART BUTTON
// ============================================
export function AddToCartButton({ id, disabled = false }) {
  const initialState = { message: "", errors: {} };
  const [open, setOpen] = useState(false);

  const add = addToCart.bind(null, id);
  const [state, dispatch, isPending] = useActionState(add, initialState);

  const form = useForm({
    resolver: zodResolver(cartItemForm),
    defaultValues: {
      quantity: "1",
    },
  });

  // Close popover on success
  if (state.message === "success" && open) {
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={disabled}
        >
          <ShoppingCart className="h-4 w-4" />
          <span className="sr-only">Add to cart</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end">
        <div className="space-y-4">
          {/* Header */}
          <div>
            <h4 className="font-semibold text-sm">Add to Cart</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter the quantity you want to add
            </p>
          </div>

          {/* Form */}
          <Form {...form}>
            <NextForm action={dispatch} className="space-y-3">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium">
                      Quantity
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="1"
                        step="1"
                        placeholder="1"
                        className="h-9 text-sm"
                        autoFocus
                      />
                    </FormControl>
                    {state.errors?.quantity && (
                      <p className="text-xs text-destructive mt-1">
                        {state.errors.quantity[0]}
                      </p>
                    )}
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isPending}
                size="sm"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-9"
              >
                {isPending ? (
                  <>
                    <div className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Adding...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="mr-2 h-3 w-3" />
                    Add to Cart
                  </>
                )}
              </Button>

              {/* Error Message */}
              {state.message && state.message !== "success" && (
                <p className="text-xs text-destructive">{state.message}</p>
              )}
            </NextForm>
          </Form>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// COMPACT INCREMENT/DECREMENT (For Table)
// ============================================
export function RemoveSingleItem({ id }) {
  const removeWithId = decreaseQTY.bind(null, id);
  return (
    <form action={removeWithId}>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
      >
        <Minus className="h-3 w-3" />
        <span className="sr-only">Decrease quantity</span>
      </Button>
    </form>
  );
}

export function AddSingleItem({ id }) {
  const addWithId = increaseQTY.bind(null, id);
  return (
    <NextForm action={addWithId}>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
      >
        <Plus className="h-3 w-3" />
        <span className="sr-only">Increase quantity</span>
      </Button>
    </NextForm>
  );
}

// ============================================
// CART PAGE VERSION (Styled buttons)
// ============================================
export function AddSingleCartVersion({ id }) {
  const addWithId = increaseQTY.bind(null, id);
  return (
    <NextForm action={addWithId}>
      <Button
        type="submit"
        size="icon"
        className="h-8 w-8 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        <span className="sr-only">Increase quantity</span>
      </Button>
    </NextForm>
  );
}

export function RemoveSingleCartVersion({ id }) {
  const removeWithId = decreaseQTY.bind(null, id);
  return (
    <NextForm action={removeWithId}>
      <Button
        type="submit"
        size="icon"
        className="h-8 w-8 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Minus className="h-4 w-4" />
        <span className="sr-only">Decrease quantity</span>
      </Button>
    </NextForm>
  );
}

export function RemoveCartItem({ id }) {
  const removeWithId = removeCartItem.bind(null, id);
  return (
    <NextForm action={removeWithId}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="mr-2 h-3 w-3" />
        Remove
      </Button>
    </NextForm>
  );
}

// ============================================
// MOBILE-OPTIMIZED CART ITEM (For Cart Page)
// ============================================
export function CartItemControls({ id, quantity }) {
  return (
    <div className="flex items-center gap-2">
      {/* Quantity Controls */}
      <div className="flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
        <RemoveSingleCartVersion id={id} />
        <span className="px-3 text-sm font-semibold text-primary min-w-[2ch] text-center">
          {quantity}
        </span>
        <AddSingleCartVersion id={id} />
      </div>

      {/* Remove Button */}
      <RemoveCartItem id={id} />
    </div>
  );
}

// ============================================
// ALTERNATIVE: INLINE ADD TO CART (No Popup)
// ============================================
export function InlineAddToCart({ id }) {
  const initialState = { message: "", errors: {} };
  const add = addToCart.bind(null, id);
  const [state, dispatch, isPending] = useActionState(add, initialState);

  return (
    <NextForm action={dispatch} className="flex items-center gap-2">
      <Input
        type="number"
        name="quantity"
        defaultValue="1"
        min="1"
        step="1"
        className="h-8 w-16 text-sm"
      />
      <Button
        type="submit"
        disabled={isPending}
        size="sm"
        className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {isPending ? (
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <ShoppingCart className="h-4 w-4" />
        )}
      </Button>
      {state.errors?.quantity && (
        <p className="text-xs text-destructive">{state.errors.quantity[0]}</p>
      )}
    </NextForm>
  );
}
