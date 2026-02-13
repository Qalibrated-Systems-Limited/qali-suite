"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { createStockAdjustment } from "@/app/mongodb/actions/adjustment-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  Package,
  Search,
  ChevronsUpDown,
} from "lucide-react";

// Adjustment types
const ADJUSTMENT_TYPES = [
  { value: "physical_count", label: "Physical Count Correction" },
  { value: "damage", label: "Damaged Goods" },
  { value: "expiry", label: "Expired Items" },
  { value: "theft", label: "Theft/Loss" },
  { value: "correction", label: "Data Entry Correction" },
  { value: "write_off", label: "Obsolete Write-Off" },
  { value: "found", label: "Unexpected Inventory Found" },
  { value: "other", label: "Other" },
];

export function CreateAdjustmentForm({ user, products }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, formAction] = useActionState(createStockAdjustment, {
    message: "",
  });

  // Form state
  const [adjustmentDate, setAdjustmentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [adjustmentType, setAdjustmentType] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([]);

  // Item being added
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [itemType, setItemType] = useState(""); // increase or decrease
  const [quantity, setQuantity] = useState("");
  const [itemReason, setItemReason] = useState("");
  const [productSearchOpen, setProductSearchOpen] = useState(false);

  // Handle server action result
  useEffect(() => {
    if (state?.success) {
      router.push("/dashboard/adjustments");
    }
  }, [state, router]);

  const handleAddItem = () => {
    if (!selectedProduct) {
      alert("Please select a product");
      return;
    }

    if (!itemType) {
      alert("Please select increase or decrease");
      return;
    }

    const parsedQty = Number(quantity);
    if (!quantity || !Number.isInteger(parsedQty) || parsedQty <= 0) {
      alert("Please enter a valid whole number quantity (no decimals)");
      return;
    }

    if (!itemReason) {
      alert("Please provide a reason for this item");
      return;
    }

    const qty = parsedQty;
    const currentStock = selectedProduct.inventory?.quantityOnHand ?? 0;
    const newStock =
      itemType === "increase" ? currentStock + qty : currentStock - qty;

    if (newStock < 0) {
      alert("Adjustment would result in negative stock");
      return;
    }

    const newItem = {
      id: Date.now(),
      productId: selectedProduct._id,
      productName: selectedProduct.name,
      SKU: selectedProduct.SKU,
      currentStock,
      adjustmentType: itemType,
      quantity: qty,
      newStock,
      unit: selectedProduct.unit,
      reason: itemReason,
    };

    setItems([...items, newItem]);

    // Reset item form
    setSelectedProduct(null);
    setItemType("");
    setQuantity("");
    setItemReason("");
  };

  const handleRemoveItem = (itemId) => {
    setItems(items.filter((item) => item.id !== itemId));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (items.length === 0) {
      alert("Please add at least one adjustment item");
      return;
    }

    if (!adjustmentType) {
      alert("Please select an adjustment type");
      return;
    }

    const formData = new FormData();
    formData.append(
      "adjustmentData",
      JSON.stringify({
        adjustmentDate,
        adjustmentType,
        description,
        notes,
        items,
      })
    );

    startTransition(() => {
      formAction(formData);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Server Error/Success */}
      {state?.message && (
        <Alert
          className={
            state.success
              ? "bg-green-500/10 border-green-500/20"
              : "bg-destructive/10 border-destructive/20"
          }
        >
          {state.success ? (
            <CheckCircle className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-destructive" />
          )}
          <AlertDescription
            className={state.success ? "text-green-600" : "text-destructive"}
          >
            {state.message}
          </AlertDescription>
        </Alert>
      )}

      {/* General Information */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg sm:text-xl">
            General Information
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs sm:text-sm">
            Provide details about this stock adjustment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="adjustmentDate" className="text-foreground text-sm sm:text-base">
              Adjustment Date
            </Label>
            <Input
              id="adjustmentDate"
              type="date"
              value={adjustmentDate}
              onChange={(e) => setAdjustmentDate(e.target.value)}
              required
              className="bg-background border-input text-foreground text-sm sm:text-base"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="adjustmentType" className="text-foreground text-sm sm:text-base">
              Adjustment Type <span className="text-destructive">*</span>
            </Label>
            <Select value={adjustmentType} onValueChange={setAdjustmentType} required>
              <SelectTrigger className="bg-background border-input text-foreground text-sm sm:text-base">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_TYPES.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-sm sm:text-base">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description" className="text-foreground text-sm sm:text-base">
              Description
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              className="bg-background border-input text-foreground text-sm sm:text-base"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes" className="text-foreground text-sm sm:text-base">
              Additional Notes
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide any additional details..."
              className="bg-background border-input text-foreground min-h-20 text-sm sm:text-base"
            />
          </div>
        </CardContent>
      </Card>

      {/* Add Items */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg sm:text-xl">
            Add Adjustment Items
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs sm:text-sm">
            Specify which products to adjust and by how much
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-foreground text-sm sm:text-base">
              Search Product
            </Label>
            <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between bg-background border-input text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    {selectedProduct ? (
                      <span className="text-sm sm:text-base">
                        {selectedProduct.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm sm:text-base">
                        Search products...
                      </span>
                    )}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full sm:w-[500px] p-0">
                <Command>
                  <CommandInput placeholder="Search products..." />
                  <CommandList>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {products.map((product) => (
                        <CommandItem
                          key={product._id}
                          value={`${product.name} ${product.SKU}`}
                          onSelect={() => {
                            setSelectedProduct(product);
                            setProductSearchOpen(false);
                          }}
                        >
                          <div className="flex-1">
                            <p className="font-medium text-sm sm:text-base">
                              {product.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {product.SKU} • Stock: {product.inventory?.quantityOnHand ?? 0} {product.unit}
                            </p>
                          </div>
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedProduct && (
            <>
              <div className="grid gap-2">
                <Label className="text-foreground text-sm sm:text-base">
                  Adjustment Type <span className="text-destructive">*</span>
                </Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    onClick={() => setItemType("increase")}
                    className={`flex-1 text-sm sm:text-base font-medium transition-all ${
                      itemType === "increase"
                        ? "bg-green-600 text-white hover:bg-green-700 border-2 border-green-600 shadow-md"
                        : "bg-green-50 text-green-700 hover:bg-green-100 border-2 border-green-200 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900 dark:border-green-800"
                    }`}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Increase Stock
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setItemType("decrease")}
                    className={`flex-1 text-sm sm:text-base font-medium transition-all ${
                      itemType === "decrease"
                        ? "bg-red-600 text-white hover:bg-red-700 border-2 border-red-600 shadow-md"
                        : "bg-red-50 text-red-700 hover:bg-red-100 border-2 border-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900 dark:border-red-800"
                    }`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Decrease Stock
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="quantity" className="text-foreground text-sm sm:text-base">
                  Quantity ({selectedProduct.unit})
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  step="1"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter quantity..."
                  className="bg-background border-input text-foreground text-sm sm:text-base"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="itemReason" className="text-foreground text-sm sm:text-base">
                  Reason for this item
                </Label>
                <Textarea
                  id="itemReason"
                  value={itemReason}
                  onChange={(e) => setItemReason(e.target.value)}
                  placeholder="Explain why this adjustment is needed..."
                  className="bg-background border-input text-foreground min-h-16 text-sm sm:text-base"
                />
              </div>

              <Button
                type="button"
                onClick={handleAddItem}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-medium text-sm sm:text-base"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add to Adjustment
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Items List */}
      {items.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-lg sm:text-xl">
              Adjustment Items ({items.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border border-border rounded-lg bg-background"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground text-sm sm:text-base">
                        {item.productName}
                      </span>
                      <Badge
                        variant={
                          item.adjustmentType === "increase"
                            ? "default"
                            : "destructive"
                        }
                        className="text-xs"
                      >
                        {item.adjustmentType === "increase" ? "+" : "-"}
                        {item.quantity} {item.unit}
                      </Badge>
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground">
                      {item.currentStock} → {item.newStock} {item.unit} • {item.reason}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveItem(item.id)}
                    className="text-destructive hover:text-destructive self-end sm:self-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
          className="border-border text-foreground text-sm sm:text-base order-2 sm:order-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending || items.length === 0}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium text-sm sm:text-base order-1 sm:order-2"
        >
          {isPending ? (
            <>Processing...</>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Create Adjustment
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
