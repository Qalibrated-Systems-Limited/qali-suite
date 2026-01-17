"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  X,
  Search,
  Package,
  Wrench,
  Calculator,
  Percent,
  Trash2,
  FileText,
  User,
  Check,
  ChevronsUpDown,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createInvoice } from "@/app/mongodb/invoice-actions";

export default function CreateInvoiceFormClient({
  customers = [],
  products = [],
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Customer Selection
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);

  // Invoice Details
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  // Line Items
  const [stockItems, setStockItems] = useState([]);
  const [serviceItems, setServiceItems] = useState([]);

  // Calculations
  const [markupPercentage, setMarkupPercentage] = useState(0);
  const [vatPercentage, setVatPercentage] = useState(16);
  const [discountPercentage, setDiscountPercentage] = useState(0);

  // Stock Item Search
  const [stockSearchOpen, setStockSearchOpen] = useState(false);

  // Select Customer
  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerSearchOpen(false);
  };

  // Add Stock Item
  const addStockItem = (product) => {
    const costPrice = Number(product.price);
    const sellingPrice = costPrice + (costPrice * markupPercentage) / 100;

    const newItem = {
      id: Date.now(),
      productId: product._id,
      name: product.name,
      SKU: product.SKU,
      unit: product.unit,
      availableStock: product.stock,
      quantity: 1,
      costPrice: costPrice,
      sellingPrice: sellingPrice,
      total: sellingPrice * 1,
    };

    setStockItems([...stockItems, newItem]);
    setStockSearchOpen(false);
  };

  // Update Stock Item
  const updateStockItem = (id, field, value) => {
    setStockItems(
      stockItems.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: Number(value) };
          updatedItem.total = updatedItem.quantity * updatedItem.sellingPrice;
          return updatedItem;
        }
        return item;
      })
    );
  };

  // Remove Stock Item
  const removeStockItem = (id) => {
    setStockItems(stockItems.filter((item) => item.id !== id));
  };

  // Add Service Item
  const addServiceItem = () => {
    setServiceItems([
      ...serviceItems,
      {
        id: Date.now(),
        name: "",
        description: "",
        unit: "service", // Default unit
        quantity: 1,
        unitPrice: 0,
        total: 0,
      },
    ]);
  };

  // Update Service Item
  const updateServiceItem = (id, field, value) => {
    setServiceItems(
      serviceItems.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: value };
          if (field === "quantity" || field === "unitPrice") {
            updatedItem.total =
              Number(updatedItem.quantity) * Number(updatedItem.unitPrice);
          }
          return updatedItem;
        }
        return item;
      })
    );
  };

  // Remove Service Item
  const removeServiceItem = (id) => {
    setServiceItems(serviceItems.filter((item) => item.id !== id));
  };

  // Apply markup to all stock items
  const applyMarkupToAll = () => {
    setStockItems(
      stockItems.map((item) => {
        const newSellingPrice =
          item.costPrice + (item.costPrice * markupPercentage) / 100;
        return {
          ...item,
          sellingPrice: newSellingPrice,
          total: newSellingPrice * item.quantity,
        };
      })
    );
  };

  // Calculate Totals
  const calculateTotals = () => {
    const stockSubtotal = stockItems.reduce((sum, item) => sum + item.total, 0);
    const serviceSubtotal = serviceItems.reduce(
      (sum, item) => sum + item.total,
      0
    );
    const subtotal = stockSubtotal + serviceSubtotal;
    const discountAmount = (subtotal * discountPercentage) / 100;
    const subtotalAfterDiscount = subtotal - discountAmount;
    const vatAmount = (subtotalAfterDiscount * vatPercentage) / 100;
    const total = subtotalAfterDiscount + vatAmount;

    return {
      subtotal,
      discountAmount,
      subtotalAfterDiscount,
      vatAmount,
      total,
    };
  };

  const totals = calculateTotals();

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Submit Invoice
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Validation
    if (!selectedCustomer) {
      setError("Please select a customer");
      return;
    }

    if (stockItems.length === 0 && serviceItems.length === 0) {
      setError("Please add at least one item or service");
      return;
    }

    // Validate service items
    for (const service of serviceItems) {
      if (!service.name || !service.unit) {
        setError("All service items must have a name and unit");
        return;
      }
    }

    const invoiceData = {
      customerId: selectedCustomer._id,
      invoiceDate,
      dueDate,
      stockItems,
      serviceItems,
      discountPercentage,
      vatPercentage,
      notes,
    };

    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(invoiceData));

    startTransition(async () => {
      const result = await createInvoice(null, formData);

      if (result.success) {
        setSuccess(`Invoice ${result.invoiceNumber} created successfully!`);
        setTimeout(() => {
          router.push(`/dashboard/invoices/${result.invoiceId}`);
        }, 1500);
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Alert */}
      {error && (
        <Alert
          variant="destructive"
          className="bg-red-500/10 border-red-500/20"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {success && (
        <Alert className="bg-green-500/10 border-green-500/20">
          <Check className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-600 dark:text-green-400">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* Customer Selection */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <User className="w-5 h-5 text-yellow-500" />
            Customer Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-foreground mb-2 block">
              Search Customer <span className="text-red-500">*</span>
            </Label>
            <Popover
              open={customerSearchOpen}
              onOpenChange={setCustomerSearchOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between bg-background border-border text-foreground"
                >
                  {selectedCustomer
                    ? selectedCustomer.name
                    : "Select customer..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-125 p-0 bg-card border-border">
                <Command>
                  <CommandInput
                    placeholder="Search customer..."
                    className="text-foreground"
                  />
                  <CommandList>
                    <CommandEmpty className="text-muted-foreground p-4">
                      No customer found.
                    </CommandEmpty>
                    <CommandGroup>
                      {customers.map((customer) => (
                        <CommandItem
                          key={customer._id}
                          value={customer.name}
                          onSelect={() => selectCustomer(customer)}
                          className="text-foreground cursor-pointer"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedCustomer?._id === customer._id
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          <div className="flex-1">
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {customer.phoneNumber} • {customer.email}
                            </p>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedCustomer && (
            <>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  <p className="text-sm text-foreground mt-1">
                    {selectedCustomer.phoneNumber || "N/A"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="text-sm text-foreground mt-1">
                    {selectedCustomer.email || "N/A"}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs text-muted-foreground">
                    Address
                  </Label>
                  <p className="text-sm text-foreground mt-1">
                    {selectedCustomer.address}
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-foreground">Invoice Date</Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
            <div>
              <Label className="text-foreground">Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock Items - Similar to previous implementation but condensed */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-foreground flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-500" />
              Stock Items
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Markup %:</Label>
              <Input
                type="number"
                value={markupPercentage}
                onChange={(e) => setMarkupPercentage(Number(e.target.value))}
                className="w-20 h-8"
                min="0"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyMarkupToAll}
              >
                <Calculator className="w-3 h-3 mr-1" />
                Apply
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Popover open={stockSearchOpen} onOpenChange={setStockSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search stock items...
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-125 p-0">
              <Command>
                <CommandInput placeholder="Search products..." />
                <CommandList>
                  <CommandEmpty>No products found.</CommandEmpty>
                  <CommandGroup>
                    {products.map((product) => (
                      <CommandItem
                        key={product._id}
                        value={`${product.name} ${product.SKU}`}
                        onSelect={() => addStockItem(product)}
                      >
                        <div className="flex-1">
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.SKU} • Stock: {product.stock} • KES{" "}
                            {product.price}
                          </p>
                        </div>
                        <Plus className="h-4 w-4 text-green-500" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {stockItems.map((item) => (
            <div key={item.id} className="p-4 bg-muted/50 rounded-lg border">
              <div className="flex justify-between mb-2">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.SKU} • Available: {item.availableStock}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeStockItem(item.id)}
                  className="text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      updateStockItem(item.id, "quantity", e.target.value)
                    }
                    min="1"
                    max={item.availableStock}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Cost</Label>
                  <Input value={item.costPrice} disabled className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">Price</Label>
                  <Input
                    type="number"
                    value={item.sellingPrice}
                    onChange={(e) =>
                      updateStockItem(item.id, "sellingPrice", e.target.value)
                    }
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Total</Label>
                  <Input
                    value={formatCurrency(item.total)}
                    disabled
                    className="h-8 font-semibold"
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Services */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-purple-500" />
              Services
            </CardTitle>
            <Button
              type="button"
              size="sm"
              onClick={addServiceItem}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Service
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {serviceItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
              <Wrench className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No services added</p>
              <p className="text-xs mt-1">
                Add services like installation, training, mileage, etc.
              </p>
            </div>
          ) : (
            serviceItems.map((item, index) => (
              <div
                key={item.id}
                className="p-4 bg-muted/50 rounded-lg border border-border"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
                      <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                        {index + 1}
                      </span>
                    </div>
                    <Label className="text-sm font-medium text-foreground">
                      Service Item
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeServiceItem(item.id)}
                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-3">
                  {/* Service Name */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Service Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={item.name}
                      onChange={(e) =>
                        updateServiceItem(item.id, "name", e.target.value)
                      }
                      placeholder="e.g., Installation, Training, Mileage"
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Description (Optional)
                    </Label>
                    <Input
                      value={item.description}
                      onChange={(e) =>
                        updateServiceItem(
                          item.id,
                          "description",
                          e.target.value
                        )
                      }
                      placeholder="Brief description of the service"
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  {/* Unit, Quantity, Price, Total */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Unit <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        value={item.unit}
                        onChange={(e) =>
                          updateServiceItem(item.id, "unit", e.target.value)
                        }
                        placeholder="hour, km, day"
                        className="bg-background border-border text-foreground"
                      />
                      <p className="text-xs text-muted-foreground mt-0.5">
                        e.g., hour, km, service
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Quantity
                      </Label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          updateServiceItem(item.id, "quantity", e.target.value)
                        }
                        placeholder="1"
                        min="0.1"
                        step="0.1"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Unit Price (KES)
                      </Label>
                      <Input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) =>
                          updateServiceItem(
                            item.id,
                            "unitPrice",
                            e.target.value
                          )
                        }
                        placeholder="0"
                        min="0"
                        step="0.01"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Total
                      </Label>
                      <Input
                        value={formatCurrency(item.total)}
                        disabled
                        className="bg-muted border-border text-foreground font-semibold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Calculations */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-green-500" />
            Calculations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Discount %</Label>
              <Input
                type="number"
                value={discountPercentage}
                onChange={(e) => setDiscountPercentage(Number(e.target.value))}
                min="0"
                max="100"
              />
            </div>
            <div>
              <Label>VAT %</Label>
              <Input
                type="number"
                value={vatPercentage}
                onChange={(e) => setVatPercentage(Number(e.target.value))}
                min="0"
                max="100"
              />
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-medium">
                {formatCurrency(totals.subtotal)}
              </span>
            </div>
            {discountPercentage > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Discount ({discountPercentage}%):
                </span>
                <span className="text-red-500">
                  -{formatCurrency(totals.discountAmount)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                VAT ({vatPercentage}%):
              </span>
              <span>{formatCurrency(totals.vatAmount)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Total:</span>
              <span className="text-green-500">
                {formatCurrency(totals.total)}
              </span>
            </div>
          </div>
          <div>
            <Label>Notes / Terms</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment terms, delivery notes..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <FileText className="mr-2 h-4 w-4" />
              Generate Invoice
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
