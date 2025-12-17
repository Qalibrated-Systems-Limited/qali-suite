"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  User,
  Package,
  Wrench,
  Calculator,
  Percent,
  FileText,
  Plus,
  Trash2,
  Search,
  Check,
  ChevronsUpDown,
  Loader2,
  AlertCircle,
  ShoppingCart,
  Edit,
  X,
  Save,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

export default function EditInvoiceFormClient({
  invoice,
  customers,
  products,
  user,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form State
  const [selectedCustomer, setSelectedCustomer] = useState(
    invoice.customer?.id || ""
  );
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);

  const [invoiceDate, setInvoiceDate] = useState(
    invoice.invoiceDate.split("T")[0]
  );
  const [dueDate, setDueDate] = useState(
    invoice.dueDate ? invoice.dueDate.split("T")[0] : ""
  );

  // Cart State

  const [stockItems, setStockItems] = useState(() => {
    return invoice.items
      .filter((item) => item.type === "stock")
      .map((item) => {
        const product = products.find((p) => p._id === item.productId);
        const currentStock = product ? product.stock : 0;

        // ✅ Correct from the start!
        const availableStock = currentStock + item.quantity;

        return {
          id: Date.now() + Math.random(),
          productId: item.productId,
          SKU: item.SKU,
          name: item.name,
          description: item.description || "",
          unit: item.unit,
          costPrice: item.unitPrice / (1 + (item.markup || 0) / 100), // Reverse calculate
          sellingPrice: item.unitPrice,
          quantity: item.quantity,
          // Will be updated from products
          total: item.total,
          availableStock: availableStock, // ✅ Accurate immediately
        };
      });
  });

  const [serviceItems, setServiceItems] = useState(
    invoice.items
      .filter((item) => item.type === "service")
      .map((item) => ({
        id: Date.now() + Math.random(),
        name: item.name,
        description: item.description || "",
        unit: item.unit || "service",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      }))
  );

  const [markupPercentage, setMarkupPercentage] = useState(0);
  const [discountPercentage, setDiscountPercentage] = useState(
    invoice.discountPercentage || 0
  );
  const [vatPercentage, setVatPercentage] = useState(invoice.taxRate || 16);
  const [notes, setNotes] = useState(invoice.notes || "");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Update available stock from products
  useEffect(() => {
    setStockItems((prev) =>
      prev.map((item) => {
        const product = products.find((p) => p._id === item.productId);
        return product
          ? { ...item, availableStock: product.stock + item.quantity }
          : item;
      })
    );
  }, [products]);

  // Format currency helper
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount || 0);
  };

  // ============================================
  // STOCK ITEMS MANAGEMENT
  // ============================================

  const addStockItem = (product) => {
    // Check if already in cart
    const existingItem = stockItems.find(
      (item) => item.productId === product._id
    );

    if (existingItem) {
      // Increase quantity if possible
      if (existingItem.quantity < existingItem.availableStock) {
        updateStockItem(existingItem.id, "quantity", existingItem.quantity + 1);
      }
    } else {
      // Add new item
      const costPrice = product.price;
      const sellingPrice = costPrice + (costPrice * markupPercentage) / 100;

      const newItem = {
        id: Date.now() + Math.random(),
        productId: product._id,
        SKU: product.SKU,
        name: product.name,
        description: product.description || "",
        unit: product.unit || "pcs",
        costPrice: costPrice,
        sellingPrice: sellingPrice,
        quantity: 1,
        availableStock: product.stock,
        total: sellingPrice * 1,
      };

      setStockItems([...stockItems, newItem]);
    }

    setStockSearchOpen(false);
  };

  const updateStockItem = (id, field, value) => {
    setStockItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: parseFloat(value) || 0 };

          // Recalculate total
          updatedItem.total = updatedItem.quantity * updatedItem.sellingPrice;

          return updatedItem;
        }
        return item;
      })
    );
  };

  const removeStockItem = (id) => {
    setStockItems(stockItems.filter((item) => item.id !== id));
  };

  const applyMarkupToAll = () => {
    setStockItems((prevItems) =>
      prevItems.map((item) => {
        const newSellingPrice =
          item.costPrice + (item.costPrice * markupPercentage) / 100;
        return {
          ...item,
          sellingPrice: newSellingPrice,
          total: item.quantity * newSellingPrice,
        };
      })
    );
  };

  // ============================================
  // SERVICE ITEMS MANAGEMENT
  // ============================================

  const addServiceItem = () => {
    setServiceItems([
      ...serviceItems,
      {
        id: Date.now(),
        name: "",
        description: "",
        unit: "service",
        quantity: 1,
        unitPrice: 0,
        total: 0,
      },
    ]);
  };

  const updateServiceItem = (id, field, value) => {
    setServiceItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: value };

          // Recalculate total for numeric fields
          if (field === "quantity" || field === "unitPrice") {
            const qty = parseFloat(updatedItem.quantity) || 0;
            const price = parseFloat(updatedItem.unitPrice) || 0;
            updatedItem.total = qty * price;
          }

          return updatedItem;
        }
        return item;
      })
    );
  };

  const removeServiceItem = (id) => {
    setServiceItems(serviceItems.filter((item) => item.id !== id));
  };

  // ============================================
  // CALCULATIONS
  // ============================================

  const subtotal = [
    ...stockItems.map((item) => item.total),
    ...serviceItems.map((item) => item.total),
  ].reduce((sum, total) => sum + total, 0);

  const discountAmount = (subtotal * discountPercentage) / 100;
  const subtotalAfterDiscount = subtotal - discountAmount;
  const taxAmount = (subtotalAfterDiscount * vatPercentage) / 100;
  const grandTotal = subtotalAfterDiscount + taxAmount;

  // ============================================
  // FORM SUBMISSION
  // ============================================

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
    const invalidServices = serviceItems.filter(
      (item) => !item.name.trim() || !item.unit.trim()
    );
    if (invalidServices.length > 0) {
      setError("Please fill in name and unit for all service items");
      return;
    }

    // Validate stock quantities
    const invalidStock = stockItems.filter(
      (item) => item.quantity > item.availableStock
    );
    if (invalidStock.length > 0) {
      setError("Some items exceed available stock");
      return;
    }

    // Prepare data
    const customer = customers.find((c) => c._id === selectedCustomer);

    const invoiceData = {
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
        address: customer.address || "",
      },
      invoiceDate,
      dueDate: dueDate || null,
      stockItems: stockItems.map((item) => ({
        productId: item.productId,
        SKU: item.SKU,
        name: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.sellingPrice,
        total: item.total,
      })),
      serviceItems: serviceItems.map((item) => ({
        name: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      })),
      discountPercentage,
      vatPercentage,
      notes,
    };

    // Create FormData
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(invoiceData));

    // Call server action
    startTransition(async () => {
      try {
        // Import the action dynamically
        const { updateInvoice } = await import("@/app/mongodb/invoice-actions");

        const result = await updateInvoice(invoice._id, {}, formData);

        if (result.success) {
          setSuccess(result.message);
          setTimeout(() => {
            router.push(`/dashboard/invoices/${invoice._id}`);
          }, 1500);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError("An unexpected error occurred");
        console.error(err);
      }
    });
  };

  const selectedCustomerData = customers.find(
    (c) => c._id === selectedCustomer
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              asChild
              className="text-muted-foreground hover:text-foreground"
            >
              <Link href={`/dashboard/invoices/${invoice._id}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            <Badge
              variant="outline"
              className="bg-blue-500/10 text-blue-600 border-blue-500/20"
            >
              <Edit className="w-3 h-3 mr-1" />
              Editing
            </Badge>
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            Edit Invoice: {invoice.invoiceNumber}
          </h1>
          <p className="text-muted-foreground">
            Modify invoice items, services, and details
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/dashboard/invoices/${invoice._id}`)}
            disabled={isPending}
          >
            <X className="mr-2 h-4 w-4" />
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
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Customer Selection */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-yellow-500" />
            Customer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Select Customer</Label>
            <Popover
              open={customerSearchOpen}
              onOpenChange={setCustomerSearchOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedCustomerData ? (
                    <span className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {selectedCustomerData.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Select customer...
                    </span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0">
                <Command>
                  <CommandInput placeholder="Search customers..." />
                  <CommandList>
                    <CommandEmpty>No customers found.</CommandEmpty>
                    <CommandGroup>
                      {customers.map((customer) => (
                        <CommandItem
                          key={customer._id}
                          value={`${customer.name} ${customer.email}`}
                          onSelect={() => {
                            setSelectedCustomer(customer._id);
                            setCustomerSearchOpen(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              selectedCustomer === customer._id
                                ? "opacity-100"
                                : "opacity-0"
                            }`}
                          />
                          <div className="flex-1">
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {customer.email || customer.phone}
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

          {selectedCustomerData && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span>{" "}
                {selectedCustomerData.email || "N/A"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Phone:</span>{" "}
                {selectedCustomerData.phone || "N/A"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Address:</span>{" "}
                {selectedCustomerData.address || "N/A"}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Invoice Date</Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Due Date (Optional)</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock Items Cart */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-blue-500" />
              Stock Items
              {stockItems.length > 0 && (
                <Badge variant="secondary">{stockItems.length}</Badge>
              )}
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
          {/* Add Stock Item */}
          <Popover open={stockSearchOpen} onOpenChange={setStockSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search and add stock items...
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[500px] p-0">
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

          {/* Stock Items List */}
          {stockItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No stock items added</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stockItems.map((item, index) => (
                <div
                  key={item.id}
                  className="p-4 bg-muted/50 rounded-lg border border-border"
                >
                  <div className="flex justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                          {index + 1}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.SKU} • Available: {item.availableStock}
                        </p>
                      </div>
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
                      <Input
                        value={formatCurrency(item.costPrice)}
                        disabled
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Selling</Label>
                      <Input
                        type="number"
                        value={item.sellingPrice}
                        onChange={(e) =>
                          updateStockItem(
                            item.id,
                            "sellingPrice",
                            e.target.value
                          )
                        }
                        min="0"
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service Items */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-purple-500" />
              Services
              {serviceItems.length > 0 && (
                <Badge variant="secondary">{serviceItems.length}</Badge>
              )}
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
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Service Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={item.name}
                      onChange={(e) =>
                        updateServiceItem(item.id, "name", e.target.value)
                      }
                      placeholder="e.g., Installation, Training"
                      className="bg-background border-border text-foreground"
                    />
                  </div>

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
                      placeholder="Brief description"
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Unit <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        value={item.unit}
                        onChange={(e) =>
                          updateServiceItem(item.id, "unit", e.target.value)
                        }
                        placeholder="hour, km"
                        className="bg-background border-border text-foreground"
                      />
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
                        min="0.1"
                        step="0.1"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Unit Price
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
              <span className="font-semibold">{formatCurrency(subtotal)}</span>
            </div>
            {discountPercentage > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Discount ({discountPercentage}%):</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                VAT ({vatPercentage}%):
              </span>
              <span className="font-semibold">{formatCurrency(taxAmount)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg">
              <span className="font-bold text-green-600">Grand Total:</span>
              <span className="font-bold text-green-600">
                {formatCurrency(grandTotal)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-500" />
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any additional notes or terms..."
            rows={4}
            className="resize-none"
          />
        </CardContent>
      </Card>

      {/* Submit Buttons */}
      <div className="flex justify-end gap-3 sticky bottom-4 bg-background/95 backdrop-blur p-4 rounded-lg border border-border shadow-lg">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/dashboard/invoices/${invoice._id}`)}
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
              Saving Changes...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
