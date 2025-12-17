"use client";

import { useActionState } from "react";
import NextForm from "next/form";
import { Button } from "../../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { units } from "../../../utils/units";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Alert, AlertDescription } from "../../../../components/ui/alert";
import { zodResolver } from "@hookform/resolvers/zod";
import { stockForm } from "../../../mongodb/validators";
import { useForm } from "react-hook-form";
import { addStock } from "../../../mongodb/actions";
import { CATEGORIES } from "../../../utils/productCategories";
import { AlertCircle, Loader2, Package } from "lucide-react";

export function CreateStockForm() {
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(addStock, initialState);

  const form = useForm({
    resolver: zodResolver(stockForm),
    defaultValues: {
      name: "",
      SKU: "",
      category: "",
      stock: "",
      price: "",
      description: "",
      unit: "",
    },
  });

  return (
    <div className="max-w-4xl mx-auto py-8">
      <Card className="bg-card border-border">
        <CardHeader className="space-y-1 border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold text-foreground">
                Add New Stock Item
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Create a new product in your inventory
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          <Form {...form}>
            <NextForm action={dispatch} className="space-y-8">
              {/* Error Alert */}
              {state.message && (
                <Alert
                  variant="destructive"
                  className="bg-red-500/10 border-red-500/20"
                >
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <AlertDescription className="text-red-600 dark:text-red-400">
                    {state.message}
                  </AlertDescription>
                </Alert>
              )}

              {/* Basic Information Section */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Basic Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Product Name */}
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Product Name <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., Wireless Mouse"
                              className="bg-background border-border text-foreground"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Enter the full product name
                          </FormDescription>
                          {state.errors?.name && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.name[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />

                    {/* SKU */}
                    <FormField
                      control={form.control}
                      name="SKU"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            SKU <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., WMOUSE-001"
                              className="bg-background border-border text-foreground font-mono"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Unique stock keeping unit
                          </FormDescription>
                          {state.errors?.SKU && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.SKU[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Category & Unit Section */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Classification
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Category */}
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Category <span className="text-red-500">*</span>
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            name="category"
                          >
                            <FormControl>
                              <SelectTrigger className="bg-background border-border text-foreground">
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-card border-border">
                              <SelectGroup>
                                {CATEGORIES.map((cat) => (
                                  <SelectItem
                                    value={cat.value}
                                    key={cat.value}
                                    className="text-foreground focus:bg-accent focus:text-foreground"
                                  >
                                    {cat.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs text-muted-foreground">
                            Product category
                          </FormDescription>
                          {state.errors?.category && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.category[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />

                    {/* Unit */}
                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Unit <span className="text-red-500">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} name="unit">
                            <FormControl>
                              <SelectTrigger className="bg-background border-border text-foreground">
                                <SelectValue placeholder="Select a unit" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-card border-border">
                              <SelectGroup>
                                {units.map((unit) => (
                                  <SelectItem
                                    value={unit}
                                    key={unit}
                                    className="text-foreground focus:bg-accent focus:text-foreground"
                                  >
                                    {unit}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs text-muted-foreground">
                            Unit of measurement
                          </FormDescription>
                          {state.errors?.unit && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.unit[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Pricing & Inventory Section */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Pricing & Inventory
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Price */}
                    <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Unit Landing Cost (KES){" "}
                            <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                KES
                              </span>
                              <Input
                                placeholder="0.00"
                                type="number"
                                step="0.01"
                                min="0"
                                className="bg-background border-border text-foreground pl-14"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Landing Cost per unit
                          </FormDescription>
                          {state.errors?.price && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.price[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />

                    {/* Stock Quantity */}
                    <FormField
                      control={form.control}
                      name="stock"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Initial Stock{" "}
                            <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="0"
                              type="number"
                              min="0"
                              className="bg-background border-border text-foreground"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Current quantity in stock
                          </FormDescription>
                          {state.errors?.stock && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.stock[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Description Section */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Additional Details
                  </h3>
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground font-medium">
                          Description
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Enter product description, specifications, or notes..."
                            className="bg-background border-border text-foreground min-h-[100px] resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-xs text-muted-foreground">
                          Optional product description (max 500 characters)
                        </FormDescription>
                        {state.errors?.description && (
                          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                            {state.errors.description[0]}
                          </p>
                        )}
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-3 pt-6 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border text-foreground hover:bg-accent"
                  onClick={() => form.reset()}
                  disabled={isPending}
                >
                  Reset
                </Button>
                <Button
                  type="submit"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Package className="mr-2 h-4 w-4" />
                      Create Stock Item
                    </>
                  )}
                </Button>
              </div>
            </NextForm>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
