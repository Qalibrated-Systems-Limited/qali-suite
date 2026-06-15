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
  Truck,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatAddress } from "@/lib/utils";
import ProjectPicker from "@/components/project-picker";

// Tax rate presets for Kenya
const TAX_RATE_OPTIONS = [
  { value: 16, label: "16% VAT", description: "Standard rate" },
  { value: 0, label: "0% Exempt", description: "VAT exempt goods" },
  { value: 8, label: "8% Reduced", description: "Petroleum products" },
];

// Service category presets
const SERVICE_CATEGORIES = [
  { value: "labor", label: "Labor", defaultUnit: "hrs" },
  { value: "mileage", label: "Mileage", defaultUnit: "km" },
  { value: "accommodation", label: "Accommodation", defaultUnit: "nights" },
  { value: "installation", label: "Installation", defaultUnit: "service" },
  { value: "consultation", label: "Consultation", defaultUnit: "hrs" },
  { value: "maintenance", label: "Maintenance", defaultUnit: "service" },
  { value: "repair", label: "Repair", defaultUnit: "service" },
  { value: "other", label: "Other Service", defaultUnit: "service" },
];

export default function EditInvoiceFormClient({
  invoice,
  customers,
  products,
  checkouts = [],
  projects = [],
  user,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form State
  const [selectedCustomer, setSelectedCustomer] = useState(
    invoice.customer?.id || "",
  );
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [checkoutSearchOpen, setCheckoutSearchOpen] = useState(false);

  const [invoiceDate, setInvoiceDate] = useState(
    invoice.invoiceDate.split("T")[0],
  );
  const [dueDate, setDueDate] = useState(
    invoice.dueDate ? invoice.dueDate.split("T")[0] : "",
  );

  // Cart State

  const [stockItems, setStockItems] = useState(() => {
    return invoice.items
      .filter((item) => item.type === "stock" || item.itemType === "product")
      .map((item) => {
        const product = products.find(
          (p) => p._id === item.productId?.toString(),
        );
        // Use inventory.quantityAvailable from the product
        const currentAvailable = product?.inventory?.quantityAvailable ?? 0;

        // Determine if this is a technician stock item
        const isFromCheckout = !!item.relatedCheckout?.checkoutId;
        const isFromRequest = !!item.relatedRequest?.requestId;
        const isTechnicianStock = isFromCheckout || isFromRequest;

        // Calculate available stock:
        // - Store items: current available + quantity already on this invoice (if stock was deducted)
        // - Technician stock: limited to the quantity on the invoice (from checkout)
        const availableStock = isTechnicianStock
          ? item.quantity // Checkout items: can't exceed original checkout quantity
          : currentAvailable + (item.stockDeducted ? item.quantity : 0);

        return {
          id: Date.now() + Math.random(),
          productId: item.productId,
          SKU: item.SKU || item.productSKU,
          name: item.name || item.productName,
          description: item.description || "",
          unit: item.unit,
          costPrice: item.costing?.unitCost || item.unitPrice,
          catalogPrice: product?.pricing?.sellingPrice || item.unitPrice,
          sellingPrice: item.unitPrice,
          quantity: item.quantity,
          taxRate: item.taxRate ?? 16, // Per-item tax rate
          total: item.total || item.amount,
          availableStock: availableStock,
          // Preserve checkout tracking for technician stock items
          checkoutId: item.relatedCheckout?.checkoutId?.toString(),
          checkoutNumber: item.relatedCheckout?.checkoutNumber,
          stockSource: isTechnicianStock ? "technician" : "store",
          technicianId: item.relatedRequest?.technicianId || "",
          technicianName: item.relatedRequest?.technicianName || "",
          // Also preserve request tracking
          requestId: item.relatedRequest?.requestId?.toString(),
          requestNumber: item.relatedRequest?.requestNumber,
        };
      });
  });

  const [serviceItems, setServiceItems] = useState(
    invoice.items
      .filter((item) => item.type === "service" || item.itemType === "service")
      .map((item) => ({
        id: Date.now() + Math.random(),
        name: item.name || item.description,
        description: item.description || "",
        unit: item.unit || "service",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 16, // Per-item tax rate
        total: item.total || item.amount,
      })),
  );

  const [markupPercentage, setMarkupPercentage] = useState(0);
  const [discountPercentage, setDiscountPercentage] = useState(
    invoice.discountPercentage || 0,
  );
  const [notes, setNotes] = useState(invoice.notes || "");
  const [projectId, setProjectId] = useState(invoice.projectId || "");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Update available stock from products
  useEffect(() => {
    setStockItems((prev) =>
      prev.map((item) => {
        const product = products.find((p) => p._id === item.productId);
        if (!product) return item;
        // Only recalculate for store items, not technician stock
        if (item.stockSource === "technician") return item;
        const available = product.inventory?.quantityAvailable ?? 0;
        return { ...item, availableStock: available + item.quantity };
      }),
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
      (item) => item.productId === product._id,
    );

    if (existingItem) {
      // Increase quantity if possible
      if (existingItem.quantity < existingItem.availableStock) {
        updateStockItem(existingItem.id, "quantity", existingItem.quantity + 1);
      }
    } else {
      // Add new item
      const costPrice = product.costing?.costPrice || 0;
      const defaultSellingPrice =
        product.pricing?.sellingPrice || 0;
      const sellingPrice =
        markupPercentage > 0
          ? costPrice + (costPrice * markupPercentage) / 100
          : defaultSellingPrice;

      const newItem = {
        id: Date.now() + Math.random(),
        productId: product._id,
        SKU: product.SKU,
        name: product.name,
        description: product.description || "",
        unit: product.unit || "pcs",
        costPrice: costPrice,
        catalogPrice: defaultSellingPrice,
        sellingPrice: sellingPrice,
        quantity: 1,
        taxRate: product.taxRate ?? 16, // Per-item tax rate
        availableStock: product.inventory?.quantityAvailable ?? 0,
        total: sellingPrice * 1,
        stockSource: "store", // From store inventory
      };

      setStockItems([...stockItems, newItem]);
    }

    setStockSearchOpen(false);
  };

  // Add item from technician checkout (trunk stock)
  const addCheckoutItem = (checkout) => {
    // Check if already added
    const exists = stockItems.some((item) => item.checkoutId === checkout._id);
    if (exists) {
      setCheckoutSearchOpen(false);
      return;
    }

    const product = checkout.product;
    const costPrice = product?.costPrice || 0;
    const sellingPrice = product?.sellingPrice || 0;

    const newItem = {
      id: Date.now() + Math.random(),
      productId: checkout.productId,
      name: checkout.productSnapshot?.name || product?.name,
      SKU: checkout.productSnapshot?.SKU || product?.SKU,
      unit: product?.unit || "pcs",
      availableStock: checkout.quantity,
      quantity: checkout.quantity,
      costPrice: costPrice,
      catalogPrice: sellingPrice,
      sellingPrice: sellingPrice,
      taxRate: 16,
      total: sellingPrice * checkout.quantity,
      // Checkout tracking
      checkoutId: checkout._id,
      checkoutNumber: checkout.checkoutNumber,
      stockSource: "technician",
      technicianId: checkout.checkedOutTo?.id,
      technicianName: checkout.checkedOutTo?.name,
    };

    setStockItems([...stockItems, newItem]);
    setCheckoutSearchOpen(false);
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
      }),
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
      }),
    );
  };

  // ============================================
  // SERVICE ITEMS MANAGEMENT
  // ============================================

  const addServiceItem = (category = null) => {
    const categoryConfig = category
      ? SERVICE_CATEGORIES.find((c) => c.value === category)
      : null;

    setServiceItems([
      ...serviceItems,
      {
        id: Date.now(),
        name: categoryConfig?.label || "",
        category: category || "other",
        description: "",
        unit: categoryConfig?.defaultUnit || "service",
        quantity: 1,
        unitPrice: 0,
        taxRate: 16,
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
      }),
    );
  };

  const removeServiceItem = (id) => {
    setServiceItems(serviceItems.filter((item) => item.id !== id));
  };

  // ============================================
  // CALCULATIONS (per-item tax rates)
  // ============================================

  const subtotal = [
    ...stockItems.map((item) => item.total),
    ...serviceItems.map((item) => item.total),
  ].reduce((sum, total) => sum + total, 0);

  const discountAmount = (subtotal * discountPercentage) / 100;
  const subtotalAfterDiscount = subtotal - discountAmount;

  // Calculate tax per item (proportionally adjusted for discount)
  const discountFactor =
    subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;

  const stockTax = stockItems.reduce((sum, item) => {
    const adjustedAmount = item.total * discountFactor;
    return sum + (adjustedAmount * (item.taxRate || 0)) / 100;
  }, 0);

  const serviceTax = serviceItems.reduce((sum, item) => {
    const adjustedAmount = item.total * discountFactor;
    return sum + (adjustedAmount * (item.taxRate || 0)) / 100;
  }, 0);

  const taxAmount = stockTax + serviceTax;
  const grandTotal = subtotalAfterDiscount + taxAmount;

  // Calculate price deviation percentage
  const getPriceDeviation = (item) => {
    if (!item.catalogPrice || item.catalogPrice === 0) return null;
    const deviation =
      ((item.sellingPrice - item.catalogPrice) / item.catalogPrice) * 100;
    return deviation;
  };

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
      (item) => !item.name.trim() || !item.unit.trim(),
    );
    if (invalidServices.length > 0) {
      setError("Please fill in name and unit for all service items");
      return;
    }

    // Validate stock quantities
    const invalidStock = stockItems.filter(
      (item) => item.quantity > item.availableStock,
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
        taxRate: item.taxRate,
        catalogPrice: item.catalogPrice,
        total: item.total,
        stockSource: item.stockSource || "store",
        relatedCheckout: item.checkoutId
          ? {
              checkoutId: item.checkoutId,
              checkoutNumber: item.checkoutNumber,
              technicianId: item.technicianId || "",
              technicianName: item.technicianName || "",
            }
          : item.requestId
            ? {
                // For items from stock requests
                requestId: item.requestId,
                requestNumber: item.requestNumber,
                technicianId: item.technicianId || "",
                technicianName: item.technicianName || "",
              }
            : undefined,
      })),
      serviceItems: serviceItems.map((item) => ({
        name: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        total: item.total,
        serviceCategory: item.category || "other",
      })),
      discountPercentage,
      notes,
      projectId: projectId || null,
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
    (c) => c._id === selectedCustomer,
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
              <PopoverContent className="w-125 p-0">
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
                {formatAddress(selectedCustomerData.address) || "N/A"}
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

          {projects.length > 0 && (
            <div className="space-y-1">
              <Label>
                Project{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <ProjectPicker
                value={projectId}
                onValueChange={setProjectId}
                projects={projects}
                placeholder="Link to a project..."
              />
            </div>
          )}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Store Inventory Search */}
            <Popover open={stockSearchOpen} onOpenChange={setStockSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                >
                  <span className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-500" />
                    From Store Inventory
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0">
                <Command>
                  <CommandInput placeholder="Search products..." />
                  <CommandList>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup heading="Store Inventory">
                      {products.map((product) => (
                        <CommandItem
                          key={product._id}
                          value={`${product.name} ${product.SKU}`}
                          onSelect={() => addStockItem(product)}
                        >
                          <div className="flex-1">
                            <p className="font-medium">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {product.SKU} • Available:{" "}
                              {product.inventory?.quantityAvailable ?? 0} • KES{" "}
                              {product.pricing?.sellingPrice || 0}
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

            {/* Technician Stock (Checkouts) Search */}
            {/* Only show checkouts that match the selected customer */}
            {(() => {
              // Filter checkouts by selected customer
              const customerCheckouts = selectedCustomer
                ? checkouts.filter(
                    (co) =>
                      co.customer?.id === selectedCustomer &&
                      !stockItems.some((si) => si.checkoutId === co._id),
                  )
                : [];

              if (!selectedCustomer) {
                return (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between border-orange-500/30 opacity-50 cursor-not-allowed"
                    disabled
                  >
                    <span className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-orange-500" />
                      Select customer first
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4" />
                  </Button>
                );
              }

              if (customerCheckouts.length === 0) {
                return null; // No matching checkouts for this customer
              }

              return (
                <Popover
                  open={checkoutSearchOpen}
                  onOpenChange={setCheckoutSearchOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between border-orange-500/30 hover:border-orange-500"
                    >
                      <span className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-orange-500" />
                        From Technician Stock ({customerCheckouts.length})
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[500px] p-0">
                    <Command>
                      <CommandInput placeholder="Search checked-out items..." />
                      <CommandList>
                        <CommandEmpty>
                          No checkout items found for this customer.
                        </CommandEmpty>
                        <CommandGroup
                          heading={`Items for ${selectedCustomerData?.name || "Customer"}`}
                        >
                          {customerCheckouts.map((checkout) => (
                            <CommandItem
                              key={checkout._id}
                              value={`${checkout.productSnapshot?.name} ${checkout.checkoutNumber} ${checkout.checkedOutTo?.name}`}
                              onSelect={() => addCheckoutItem(checkout)}
                            >
                              <div className="flex-1">
                                <p className="font-medium">
                                  {checkout.productSnapshot?.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {checkout.checkoutNumber} • Qty:{" "}
                                  {checkout.quantity} • With:{" "}
                                  {checkout.checkedOutTo?.name}
                                </p>
                              </div>
                              <Plus className="h-4 w-4 text-orange-500" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              );
            })()}
          </div>

          {/* Stock Items List */}
          {stockItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No stock items added</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stockItems.map((item, index) => {
                const deviation = getPriceDeviation(item);
                const hasDeviation =
                  deviation !== null && Math.abs(deviation) > 0.01;

                return (
                  <div
                    key={item.id}
                    className="p-4 bg-muted/50 rounded-lg border border-border"
                  >
                    <div className="flex justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center",
                            item.stockSource === "technician"
                              ? "bg-orange-500/10"
                              : "bg-blue-500/10",
                          )}
                        >
                          <span
                            className={cn(
                              "text-sm font-semibold",
                              item.stockSource === "technician"
                                ? "text-orange-600 dark:text-orange-400"
                                : "text-blue-600 dark:text-blue-400",
                            )}
                          >
                            {index + 1}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{item.name}</p>
                            {item.stockSource === "technician" && (
                              <Badge
                                variant="outline"
                                className="bg-orange-500/10 text-orange-600 border-orange-500/20 text-xs"
                              >
                                <Truck className="w-3 h-3 mr-1" />
                                {item.technicianName}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {item.SKU} • Available: {item.availableStock}
                            {item.catalogPrice > 0 && (
                              <span className="ml-2">
                                • Catalog: {formatCurrency(item.catalogPrice)}
                              </span>
                            )}
                            {item.checkoutNumber && (
                              <span className="ml-2">
                                • {item.checkoutNumber}
                              </span>
                            )}
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

                    <div className="grid grid-cols-5 gap-2">
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
                        <div className="relative">
                          <Input
                            type="number"
                            value={item.sellingPrice}
                            onChange={(e) =>
                              updateStockItem(
                                item.id,
                                "sellingPrice",
                                e.target.value,
                              )
                            }
                            min="0"
                            className={cn(
                              "h-8",
                              hasDeviation &&
                                deviation < 0 &&
                                "border-orange-500 bg-orange-500/5",
                              hasDeviation &&
                                deviation > 0 &&
                                "border-green-500 bg-green-500/5",
                            )}
                          />
                          {hasDeviation && (
                            <span
                              className={cn(
                                "absolute -top-5 right-0 text-[10px] font-medium px-1 rounded",
                                deviation < 0
                                  ? "text-orange-600 bg-orange-500/10"
                                  : "text-green-600 bg-green-500/10",
                              )}
                            >
                              {deviation > 0 ? "+" : ""}
                              {deviation.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">VAT %</Label>
                        <Select
                          value={String(item.taxRate)}
                          onValueChange={(val) =>
                            updateStockItem(item.id, "taxRate", val)
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TAX_RATE_OPTIONS.map((opt) => (
                              <SelectItem
                                key={opt.value}
                                value={String(opt.value)}
                              >
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                );
              })}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Service
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SERVICE_CATEGORIES.map((cat) => (
                  <DropdownMenuItem
                    key={cat.value}
                    onClick={() => addServiceItem(cat.value)}
                  >
                    {cat.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
                          e.target.value,
                        )
                      }
                      placeholder="Brief description"
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div className="grid grid-cols-5 gap-3">
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
                            e.target.value,
                          )
                        }
                        min="0"
                        step="0.01"
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        VAT %
                      </Label>
                      <Select
                        value={String(item.taxRate)}
                        onValueChange={(val) =>
                          updateServiceItem(item.id, "taxRate", Number(val))
                        }
                      >
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TAX_RATE_OPTIONS.map((opt) => (
                            <SelectItem
                              key={opt.value}
                              value={String(opt.value)}
                            >
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Overall Discount %</Label>
            <Input
              type="number"
              value={discountPercentage}
              onChange={(e) => setDiscountPercentage(Number(e.target.value))}
              min="0"
              max="100"
              className="max-w-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Applied proportionally to all items
            </p>
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
                VAT (per item rates):
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
