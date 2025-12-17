"use client";

import { useActionState } from "react";
import NextForm from "next/form";
import { units } from "../../../../utils/units";
import { Button } from "../../../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../../components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "../../../../../components/ui/form";
import { Input } from "../../../../../components/ui/input";
import { Textarea } from "../../../../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../components/ui/select";
import { Alert, AlertDescription } from "../../../../../components/ui/alert";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { stockForm } from "../../../../mongodb/validators";
import { updateStock } from "../../../../mongodb/actions";
import { CATEGORIES } from "../../../../utils/productCategories";
import { AlertCircle, Loader2, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";

export default function UpdateStockForm({ stock }) {
  const router = useRouter();
  const initialState = { message: "", errors: {} };
  const updateWithId = updateStock.bind(null, stock._id.toString());
  const [state, dispatch, isPending] = useActionState(
    updateWithId,
    initialState
  );

  const form = useForm({
    resolver: zodResolver(stockForm),
    defaultValues: {
      name: stock.name,
      SKU: stock.SKU,
      price: stock.price,
      description: stock.description,
      stock: stock.stock,
      category: stock.category,
      unit: stock.unit,
    },
  });

  const handleCancel = () => {
    router.push("/dashboard/stocks");
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <Card className="bg-card border-border">
        <CardHeader className="space-y-1 border-b border-border pb-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-foreground">
                Update Stock Item
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Modify product details and inventory levels
              </CardDescription>
            </div>
            <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <p className="text-xs font-mono text-blue-600 dark:text-blue-400">
                {stock.SKU}
              </p>
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
                              className="bg-background border-border text-foreground"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Full product name
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
                            defaultValue={stock.category}
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
                          <Select
                            onValueChange={field.onChange}
                            name="unit"
                            defaultValue={stock.unit ?? ""}
                          >
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
                    Cost & Inventory
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Price */}
                    <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Landing cost (KES){" "}
                            <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                KES
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="bg-background border-border text-foreground pl-14"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Unit Landing Cost
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
                            Current Stock{" "}
                            <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              className="bg-background border-border text-foreground"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Quantity in stock
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
                            placeholder="Enter product description..."
                            className="bg-background border-border text-foreground min-h-[100px] resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-xs text-muted-foreground">
                          Optional product description
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
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Update Stock
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
