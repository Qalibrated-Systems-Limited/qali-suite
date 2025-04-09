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
} from "../../../components/ui/form";
import { DialogClose } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";

import { useActionState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cartItemForm } from "../../mongodb/validators";
import { PopoverClose } from "@radix-ui/react-popover";
import { Minus, Plus } from "lucide-react";

export function AddToCartButton({ id }) {
  const initialState = { message: "", errors: {} };

  const add = addToCart.bind(null, id);
  const [state, dispatch, isPending] = useActionState(add, initialState);

  const form = useForm({
    resolver: zodResolver(cartItemForm),
    defaultValues: {
      quantity: "",
    },
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="bg-pink-500 text-white px-3 py-1 rounded-xl hover:bg-pink-600">
          Add to Cart
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <Form {...form}>
          <NextForm action={dispatch}>
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} type="text" />
                  </FormControl>
                  <div
                    id="quantity-error"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {state.errors?.quantity &&
                      state.errors.quantity.map((error) => (
                        <p className="mt-2 text-sm text-red-500" key={error}>
                          {error}
                        </p>
                      ))}
                  </div>
                </FormItem>
              )}
            />

            <div className="flex justify-end mt-4">
              <Button variant="outline" className="text-sm">
                {isPending ? "Loading" : "Submit"}
              </Button>
            </div>
            {state.message && (
              <p className="mt-2 text-sm text-red-500" key={state.message}>
                {state.message}
              </p>
            )}
          </NextForm>
        </Form>
      </PopoverContent>
    </Popover>
  );
}

export function RemoveSingleItem({ id }) {
  const removeWithId = decreaseQTY.bind(null, id);
  return (
    <form action={removeWithId}>
      <button className="text-pink-500 hover:bg-pink-100 dark:hover:bg-zinc-700 p-1 rounded">
        <Minus className="w-4 h-4" />
      </button>
    </form>
  );
}

export function AddSingleItem({ id }) {
  const addWithId = increaseQTY.bind(null, id);
  return (
    <NextForm action={addWithId}>
      <button className="text-pink-500 hover:bg-pink-100 dark:hover:bg-zinc-700 p-1 rounded">
        <Plus className="w-4 h-4" />
      </button>
    </NextForm>
  );
}

export function AddSingleCartVersion({ id }) {
  const addWithId = increaseQTY.bind(null, id);
  return (
    <NextForm action={addWithId}>
      <button className="px-2 py-1 text-white bg-pink-500 dark:bg-pink-600 rounded hover:bg-pink-600 dark:hover:bg-pink-700">
        +
      </button>
    </NextForm>
  );
}

export function RemoveSingleCartVersion({ id }) {
  const removeWithId = decreaseQTY.bind(null, id);
  return (
    <NextForm action={removeWithId}>
      <button className="px-2 py-1 text-white bg-pink-500 dark:bg-pink-600 rounded hover:bg-pink-600 dark:hover:bg-pink-700">
        -
      </button>
    </NextForm>
  );
}

export function RemoveCartItem({ id }) {
  const removeWithId = removeCartItem.bind(null, id);
  return (
    <NextForm action={removeWithId}>
      <button className="text-red-500 hover:underline">Remove</button>
    </NextForm>
  );
}
