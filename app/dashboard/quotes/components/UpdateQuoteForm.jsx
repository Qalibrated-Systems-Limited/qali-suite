"use client";

import { useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Search,
  Package,
  Wrench,
  Calculator,
  Trash2,
  FileText,
  User,
  Check,
  ChevronsUpDown,
  Loader2,
  AlertCircle,
  Calendar,
  Percent,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { updateQuote } from "@/app/mongodb/actions/quote-actions";

// Helper to format date string
function formatDateForInput(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toISOString().split("T")[0];
}

// Helper to initialize stock items from quote
function initStockItems(quote, products) {
  if (!quote?.items) return [];

  return quote.items
    .filter((item) => item.itemType === "product")
    .map((item, index) => {
      const product = products.find((p) => p._id === item.product?.id);
      return {
        id: item._id || `stock-${index}`,
        productId: item.product?.id,
        name: item.product?.name || item.description,
        SKU: item.product?.sku,
        unit: item.unit,
        availableStock: product?.stock || 999,
        quantity: item.quantity,
        costPrice: item.costPrice || item.unitPrice,
        sellingPrice: item.unitPrice,
        discountPercentage: item.discountPercentage || 0,
        taxRate: item.taxRate || 16,
        total: item.lineTotal,
      };
    });
}

// Helper to initialize service items from quote
function initServiceItems(quote) {
  if (!quote?.items) return [];

  return quote.items
    .filter((item) => item.itemType === "service")
    .map((item, index) => ({
      id: item._id || `service-${index}`,
      name: item.description,
      description: item.notes || "",
      unit: item.unit || "service",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountPercentage: item.discountPercentage || 0,
      taxRate: item.taxRate || 16,
      total: item.lineTotal,
    }));
}

// Helper to find customer
function initCustomer(quote, customers) {
  if (!quote?.customer?.partyId) return null;
  return customers.find((c) => c._id === quote.customer.partyId) || null;
}

export default function UpdateQuoteForm({
  quote,
  customers = [],
  products = [],
}) {
  const router = useRouter();

  // Bind quote ID to action
  const updateQuoteWithId = updateQuote.bind(null, quote._id);
  const [state, formAction, isPending] = useActionState(updateQuoteWithId, null);

  // Customer Selection
  const [selectedCustomer, setSelectedCustomer] = useState(
    () => initCustomer(quote, customers)
  );
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);

  // Quote Details
  const [quoteDate, setQuoteDate] = useState(formatDateForInput(quote.quoteDate));
  const [validUntil, setValidUntil] = useState(formatDateForInput(quote.validUntil));
  const [reference, setReference] = useState(quote.reference || "");
  const [notes, setNotes] = useState(quote.notes || "");
  const [terms, setTerms] = useState(quote.termsAndConditions || "");

  // Line Items
  const [stockItems, setStockItems] = useState(() => initStockItems(quote, products));
  const [serviceItems, setServiceItems] = useState(() => initServiceItems(quote));

  // Calculations
  const [markupPercentage, setMarkupPercentage] = useState(0);
  const [vatPercentage, setVatPercentage] = useState(16);
  const [discountPercentage, setDiscountPercentage] = useState(
    quote.discountPercentage || 0
  );

  // Stock Item Search
  const [stockSearchOpen, setStockSearchOpen] = useState(false);

  // Select Customer
  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerSearchOpen(false);
  };

  // Add Stock Item
  const addStockItem = (product) => {
    // ERP: Use costing.costPrice for COGS, pricing.sellingPrice for default selling price
    const costPrice = Number(product.costing?.costPrice) || 0;
    const defaultSellingPrice = Number(product.pricing?.sellingPrice) || 0;
    const minimumPrice = Number(product.pricing?.minimumPrice) || 0;

    const newItem = {
      id: `new-${Date.now()}`,
      productId: product._id,
      name: product.name,
      SKU: product.SKU,
      unit: product.unit,
      availableStock: product.inventory?.quantityAvailable ?? 0,
      quantity: 1,
      costPrice: costPrice,
      sellingPrice: defaultSellingPrice, // Admin can edit this
      minimumPrice: minimumPrice,
      discountPercentage: 0,
      taxRate: vatPercentage,
      total: defaultSellingPrice,
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
          const gross = updatedItem.quantity * updatedItem.sellingPrice;
          const discountAmount = gross * (updatedItem.discountPercentage / 100);
          const afterDiscount = gross - discountAmount;
          const taxAmount = afterDiscount * (updatedItem.taxRate / 100);
          updatedItem.total = afterDiscount + taxAmount;
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
        id: `new-${Date.now()}`,
        name: "",
        description: "",
        unit: "service",
        quantity: 1,
        unitPrice: 0,
        discountPercentage: 0,
        taxRate: vatPercentage,
        total: 0,
      },
    ]);
  };

  // Update Service Item
  const updateServiceItem = (id, field, value) => {
    setServiceItems(
      serviceItems.map((item) => {
        if (item.id === id) {
          const updatedItem = {
            ...item,
            [field]: ["quantity", "unitPrice", "discountPercentage", "taxRate"].includes(field)
              ? Number(value)
              : value,
          };
          const gross = updatedItem.quantity * updatedItem.unitPrice;
          const discountAmount = gross * (updatedItem.discountPercentage / 100);
          const afterDiscount = gross - discountAmount;
          const taxAmount = afterDiscount * (updatedItem.taxRate / 100);
          updatedItem.total = afterDiscount + taxAmount;
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
        const gross = item.quantity * newSellingPrice;
        const discountAmount = gross * (item.discountPercentage / 100);
        const afterDiscount = gross - discountAmount;
        const taxAmount = afterDiscount * (item.taxRate / 100);
        return {
          ...item,
          sellingPrice: newSellingPrice,
          total: afterDiscount + taxAmount,
        };
      })
    );
  };

  // Calculate Totals
  const calculateTotals = () => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    stockItems.forEach((item) => {
      const gross = item.quantity * item.sellingPrice;
      const discountAmount = gross * (item.discountPercentage / 100);
      const afterDiscount = gross - discountAmount;
      const taxAmount = afterDiscount * (item.taxRate / 100);

      subtotal += afterDiscount;
      totalDiscount += discountAmount;
      totalTax += taxAmount;
    });

    serviceItems.forEach((item) => {
      const gross = item.quantity * item.unitPrice;
      const discountAmount = gross * (item.discountPercentage / 100);
      const afterDiscount = gross - discountAmount;
      const taxAmount = afterDiscount * (item.taxRate / 100);

      subtotal += afterDiscount;
      totalDiscount += discountAmount;
      totalTax += taxAmount;
    });

    const globalDiscountAmount = subtotal * (discountPercentage / 100);
    const finalSubtotal = subtotal - globalDiscountAmount;
    const total = finalSubtotal + totalTax;

    return {
      subtotal,
      totalDiscount: totalDiscount + globalDiscountAmount,
      totalTax,
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

  // Build items array for server action
  const buildItems = () => {
    const items = [];

    stockItems.forEach((item) => {
      items.push({
        itemType: "product",
        productId: item.productId,
        description: item.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.sellingPrice,
        discountPercentage: item.discountPercentage,
        taxRate: item.taxRate,
      });
    });

    serviceItems.forEach((item) => {
      items.push({
        itemType: "service",
        description: item.name,
        notes: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercentage: item.discountPercentage,
        taxRate: item.taxRate,
      });
    });

    return items;
  };

  // Hidden data for form submission
  const formDataValue = JSON.stringify({
    customerId: selectedCustomer?._id,
    quoteDate,
    validUntil,
    reference,
    notes,
    termsAndConditions: terms,
    items: buildItems(),
  });

  // Server action handles redirect on success

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="data" value={formDataValue} />

      {/* Error Alert */}
      {state?.error && (
        <Alert variant="destructive" className="bg-red-500/10 border-red-500/20">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {state?.success && (
        <Alert className="bg-green-500/10 border-green-500/20">
          <Check className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-600 dark:text-green-400">
            {state.message} Redirecting...
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
            <Popover open={customerSearchOpen} onOpenChange={setCustomerSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between bg-background border-border text-foreground"
                >
                  {selectedCustomer ? selectedCustomer.name : "Select customer..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full sm:w-[400px] p-0 bg-card border-border">
                <Command>
                  <CommandInput placeholder="Search customer..." className="text-foreground" />
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
                              selectedCustomer?._id === customer._id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="flex-1">
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {customer.phone} • {customer.email}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  <p className="text-sm text-foreground mt-1">
                    {selectedCustomer.phone || "N/A"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="text-sm text-foreground mt-1">
                    {selectedCustomer.email || "N/A"}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label className="text-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Quote Date
              </Label>
              <Input
                type="date"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
                className="bg-background border-border text-foreground mt-1"
              />
            </div>
            <div>
              <Label className="text-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Valid Until <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="bg-background border-border text-foreground mt-1"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <Label className="text-foreground">Reference / PO Number</Label>
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Customer's reference"
                className="bg-background border-border text-foreground mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock Items */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-foreground flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-500" />
              Products
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Markup %:</Label>
              <Input
                type="number"
                value={markupPercentage}
                onChange={(e) => setMarkupPercentage(Number(e.target.value))}
                className="w-16 sm:w-20 h-8"
                min="0"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyMarkupToAll}
                disabled={stockItems.length === 0}
              >
                <Calculator className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Apply</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Popover open={stockSearchOpen} onOpenChange={setStockSearchOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Add more products...
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full sm:w-[400px] p-0">
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
                            {product.SKU} • Stock: {product.inventory?.quantityAvailable ?? 0} • KES {product.pricing?.sellingPrice || 0}
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

          {stockItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No products</p>
            </div>
          ) : (
            stockItems.map((item) => (
              <div key={item.id} className="p-4 bg-muted/50 rounded-lg border">
                <div className="flex justify-between mb-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.SKU} • Available: {item.availableStock} {item.unit}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStockItem(item.id)}
                    className="text-red-500 h-8 w-8 p-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  <div>
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateStockItem(item.id, "quantity", e.target.value)}
                      min="1"
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit Price</Label>
                    <Input
                      type="number"
                      value={item.sellingPrice}
                      onChange={(e) => updateStockItem(item.id, "sellingPrice", e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Discount %</Label>
                    <Input
                      type="number"
                      value={item.discountPercentage}
                      onChange={(e) => updateStockItem(item.id, "discountPercentage", e.target.value)}
                      min="0"
                      max="100"
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Tax %</Label>
                    <Input
                      type="number"
                      value={item.taxRate}
                      onChange={(e) => updateStockItem(item.id, "taxRate", e.target.value)}
                      min="0"
                      className="h-8"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 lg:col-span-2">
                    <Label className="text-xs">Line Total</Label>
                    <Input
                      value={formatCurrency(item.total)}
                      disabled
                      className="h-8 font-semibold bg-muted"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
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
              <span className="hidden sm:inline">Add Service</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {serviceItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
              <Wrench className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No services</p>
            </div>
          ) : (
            serviceItems.map((item, index) => (
              <div key={item.id} className="p-4 bg-muted/50 rounded-lg border border-border">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
                      <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                        {index + 1}
                      </span>
                    </div>
                    <Label className="text-sm font-medium text-foreground">Service Item</Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeServiceItem(item.id)}
                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 w-8 p-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Service Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        value={item.name}
                        onChange={(e) => updateServiceItem(item.id, "name", e.target.value)}
                        placeholder="e.g., Installation, Training"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateServiceItem(item.id, "description", e.target.value)}
                        placeholder="Brief description"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Unit</Label>
                      <Input
                        value={item.unit}
                        onChange={(e) => updateServiceItem(item.id, "unit", e.target.value)}
                        placeholder="hour, day"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Qty</Label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateServiceItem(item.id, "quantity", e.target.value)}
                        min="0.1"
                        step="0.1"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Price</Label>
                      <Input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateServiceItem(item.id, "unitPrice", e.target.value)}
                        min="0"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Disc %</Label>
                      <Input
                        type="number"
                        value={item.discountPercentage}
                        onChange={(e) => updateServiceItem(item.id, "discountPercentage", e.target.value)}
                        min="0"
                        max="100"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Tax %</Label>
                      <Input
                        type="number"
                        value={item.taxRate}
                        onChange={(e) => updateServiceItem(item.id, "taxRate", e.target.value)}
                        min="0"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Total</Label>
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

      {/* Summary & Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notes & Terms */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-500" />
              Notes & Terms
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-foreground">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={3}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-foreground">Terms & Conditions</Label>
              <Textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Payment terms, delivery conditions..."
                rows={3}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>

        {/* Calculations */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-green-500" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="flex items-center gap-1">
                <Percent className="h-3 w-3" />
                Additional Discount %
              </Label>
              <Input
                type="number"
                value={discountPercentage}
                onChange={(e) => setDiscountPercentage(Number(e.target.value))}
                min="0"
                max="100"
                className="mt-1"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
              </div>
              {totals.totalDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Discount:</span>
                  <span className="text-red-500">-{formatCurrency(totals.totalDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax:</span>
                <span>{formatCurrency(totals.totalTax)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total:</span>
                <span className="text-green-500">{formatCurrency(totals.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending || !selectedCustomer || (stockItems.length === 0 && serviceItems.length === 0)}
          className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
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
    </form>
  );
}
