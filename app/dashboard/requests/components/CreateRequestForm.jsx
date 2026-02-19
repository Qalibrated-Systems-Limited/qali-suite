"use client";

import { useState, startTransition } from "react";
import { useActionState } from "react";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import {
  IconCalendar,
  IconPlus,
  IconTrash,
  IconPackage,
  IconX,
  IconAlertCircle,
} from "@tabler/icons-react";
import { cn, stockRequestTypes, stockRequestTypeConfig } from "@/lib/utils";
import ProjectPicker from "@/components/project-picker";

// ============================================
// HELPER: Get available stock from product
// ============================================
function getAvailableStock(product) {
  return product.inventory?.quantityAvailable ?? product.inventory?.quantityOnHand ?? 0;
}

function getSellingPrice(product) {
  return product.pricing?.sellingPrice ?? 0;
}

// ============================================
// PRODUCT SEARCH COMBOBOX
// ============================================
function ProductSearchCombobox({ products, onSelect, disabled }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [open, setOpen] = useState(false);

  const filteredProducts = products.filter((p) =>
    `${p.name} ${p.SKU}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between"
          disabled={disabled}
        >
          <IconPackage className="mr-2 h-4 w-4" />
          Search products...
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-100 p-0" align="start">
        <div className="p-2">
          <Input
            placeholder="Search by name or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-2"
          />
        </div>
        <div className="max-h-75 overflow-y-auto">
          {filteredProducts.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No products found
            </div>
          ) : (
            filteredProducts.map((product) => {
              const availableStock = getAvailableStock(product);
              return (
                <button
                  key={product._id}
                  className="w-full px-4 py-2 text-left hover:bg-accent flex items-center justify-between"
                  onClick={() => {
                    onSelect(product);
                    setOpen(false);
                    setSearchTerm("");
                  }}
                >
                  <div className="flex-1">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      SKU: {product.SKU} • Available: {availableStock} {product.unit}
                    </p>
                  </div>
                  {availableStock === 0 && (
                    <Badge variant="destructive" className="ml-2">
                      Out of Stock
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// CUSTOMER SEARCH COMBOBOX
// ============================================
function CustomerSearchCombobox({ customers, selectedCustomer, onSelect, disabled, error }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [open, setOpen] = useState(false);

  const filteredCustomers = customers.filter((c) =>
    `${c.name} ${c.email || ""} ${c.phone || ""}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            "w-full justify-between",
            error && "border-destructive"
          )}
          disabled={disabled}
        >
          {selectedCustomer ? (
            <span className="truncate">{selectedCustomer.name}</span>
          ) : (
            <span className="text-muted-foreground">Select customer...</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-100 p-0" align="start">
        <div className="p-2">
          <Input
            placeholder="Search by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-2"
          />
        </div>
        <div className="max-h-75 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No customers found
            </div>
          ) : (
            filteredCustomers.map((customer) => (
              <button
                key={customer._id}
                className="w-full px-4 py-2 text-left hover:bg-accent flex items-center justify-between"
                onClick={() => {
                  onSelect(customer);
                  setOpen(false);
                  setSearchTerm("");
                }}
              >
                <div className="flex-1">
                  <p className="font-medium">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {customer.email && `${customer.email} • `}
                    {customer.phone || "No phone"}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// MAIN FORM COMPONENT
// ============================================
export function CreateStockRequestForm({
  products = [],
  customers = [],
  projects = [],
  user,
  createRequestAction,
}) {
  const [state, formAction, isPending] = useActionState(createRequestAction, null);

  // Extract errors from state - field errors and form-level error
  const fieldErrors = state?.fieldErrors || {};
  const formError = state?.error || null;

  // Form state
  const [requestType, setRequestType] = useState(state?.values?.requestType || "");
  const [selectedCustomer, setSelectedCustomer] = useState(() => {
    // Restore customer from state if available
    if (state?.values?.customerId && state?.values?.customerName) {
      return {
        _id: state.values.customerId,
        name: state.values.customerName,
        email: state.values.customerEmail || "",
        phone: state.values.customerPhone || "",
      };
    }
    return null;
  });
  const [priority, setPriority] = useState(state?.values?.priority || "normal");
  const [requiredByDate, setRequiredByDate] = useState(
    state?.values?.requiredByDate ? new Date(state.values.requiredByDate) : undefined
  );
  const [notes, setNotes] = useState(state?.values?.notes || "");
  const [projectId, setProjectId] = useState(state?.values?.projectId || "");

  // Determine if customer is required based on request type
  const typeConfig = stockRequestTypeConfig[requestType];
  const requiresCustomer = typeConfig?.requiresCustomer ?? true;
  const [items, setItems] = useState(() => {
    if (state?.values?.items) {
      try {
        return typeof state.values.items === 'string'
          ? JSON.parse(state.values.items)
          : state.values.items;
      } catch {
        return [];
      }
    }
    return [];
  });

  // Item being added
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [itemNotes, setItemNotes] = useState("");

  // ============================================
  // ADD ITEM TO REQUEST
  // ============================================
  const handleAddItem = () => {
    if (!selectedProduct) {
      alert("Please select a product");
      return;
    }

    if (!quantity || parseInt(quantity) <= 0) {
      alert("Please enter a valid quantity");
      return;
    }

    const qty = parseInt(quantity);
    const availableStock = getAvailableStock(selectedProduct);

    if (qty > availableStock) {
      alert(
        `Only ${availableStock} ${selectedProduct.unit} available in stock`
      );
      return;
    }

    const newItem = {
      id: Date.now(), // Temporary ID
      productId: selectedProduct._id,
      productName: selectedProduct.name,
      SKU: selectedProduct.SKU,
      currentStock: availableStock,
      requestedQuantity: qty,
      unitPrice: getSellingPrice(selectedProduct),
      unit: selectedProduct.unit,
      notes: itemNotes,
    };

    setItems([...items, newItem]);

    // Reset item form
    setSelectedProduct(null);
    setQuantity("");
    setItemNotes("");
  };

  // ============================================
  // REMOVE ITEM
  // ============================================
  const handleRemoveItem = (itemId) => {
    setItems(items.filter((item) => item.id !== itemId));
  };

  // ============================================
  // CALCULATE TOTALS
  // ============================================
  const totalItems = items.reduce(
    (sum, item) => sum + item.requestedQuantity,
    0
  );
  const totalValue = items.reduce(
    (sum, item) => sum + item.requestedQuantity * item.unitPrice,
    0
  );

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // ============================================
  // SUBMIT FORM
  // ============================================
  const handleSubmit = (e) => {
    e.preventDefault();

    if (!requestType) {
      alert("Please select a request type");
      return;
    }

    if (items.length === 0) {
      alert("Please add at least one item to the request");
      return;
    }

    if (requiresCustomer && !selectedCustomer) {
      alert("Please select a customer");
      return;
    }

    const formData = new FormData();
    formData.append("requestType", requestType);

    // Customer data (or "Internal" for internal requests)
    if (requiresCustomer && selectedCustomer) {
      formData.append("customerId", selectedCustomer._id);
      formData.append("customerName", selectedCustomer.name);
      formData.append("customerEmail", selectedCustomer.email || "");
      formData.append("customerPhone", selectedCustomer.phone || "");
      formData.append("customerAddress", selectedCustomer.address?.line1 || "");
      formData.append("customerTaxPin", selectedCustomer.taxPin || "");
    } else {
      formData.append("customerId", "");
      formData.append("customerName", "Internal Use");
    }

    formData.append("priority", priority);
    formData.append("notes", notes);
    if (requiredByDate) {
      formData.append("requiredByDate", requiredByDate.toISOString());
    }

    // Add items as JSON
    formData.append("items", JSON.stringify(items));

    // Project (optional)
    if (projectId) {
      formData.append("projectId", projectId);
    }

    startTransition(() => {
      formAction(formData);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Form-level Error Message */}
      {formError && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <IconAlertCircle className="h-5 w-5" />
              <p>{formError}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header Info */}
      <Card>
        <CardHeader>
          <CardTitle>Request Details</CardTitle>
          <CardDescription>
            Fill in the basic information for this stock request
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Request Type - Full Width */}
          <div className="space-y-2">
            <Label htmlFor="requestType">
              Request Type <span className="text-destructive">*</span>
            </Label>
            <Select value={requestType} onValueChange={setRequestType}>
              <SelectTrigger className={fieldErrors.requestType ? "border-destructive" : ""}>
                <SelectValue placeholder="Select request type..." />
              </SelectTrigger>
              <SelectContent>
                {stockRequestTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    <div className="flex flex-col">
                      <span>{stockRequestTypeConfig[type]?.label || type}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeConfig && (
              <p className="text-xs text-muted-foreground">{typeConfig.description}</p>
            )}
            {fieldErrors.requestType && (
              <p className="text-xs text-destructive">{fieldErrors.requestType}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Customer - conditional based on requestType */}
            {requiresCustomer && (
              <div className="space-y-2">
                <Label>
                  Customer <span className="text-destructive">*</span>
                </Label>
                <CustomerSearchCombobox
                  customers={customers}
                  selectedCustomer={selectedCustomer}
                  onSelect={setSelectedCustomer}
                  disabled={false}
                  error={fieldErrors.customer}
                />
                {selectedCustomer && (
                  <div className="p-2 bg-muted rounded-md flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{selectedCustomer.name}</p>
                      {(selectedCustomer.email || selectedCustomer.phone) && (
                        <p className="text-xs text-muted-foreground">
                          {selectedCustomer.email && `${selectedCustomer.email}`}
                          {selectedCustomer.email && selectedCustomer.phone && " • "}
                          {selectedCustomer.phone}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedCustomer(null)}
                    >
                      <IconX className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {fieldErrors.customer && (
                  <p className="text-xs text-destructive">{fieldErrors.customer}</p>
                )}
              </div>
            )}

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className={fieldErrors.priority ? "border-destructive" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              {fieldErrors.priority && (
                <p className="text-xs text-destructive">{fieldErrors.priority}</p>
              )}
            </div>

            {/* Required By Date */}
            <div className="space-y-2">
              <Label>Required By Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !requiredByDate && "text-muted-foreground"
                    )}
                  >
                    <IconCalendar className="mr-2 h-4 w-4" />
                    {requiredByDate ? (
                      format(requiredByDate, "PPP")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={requiredByDate}
                    onSelect={setRequiredByDate}
                    initialFocus
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return date < today;
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Department (Read-only) */}
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={user.department || "N/A"} disabled />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">General Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional information about this request..."
              rows={3}
              className={fieldErrors.notes ? "border-destructive" : ""}
            />
            {fieldErrors.notes && (
              <p className="text-xs text-destructive">{fieldErrors.notes}</p>
            )}
          </div>

          {/* Project (optional) */}
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
              <p className="text-xs text-muted-foreground">
                Tag this request to a project for cost tracking
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Items Section */}
      <Card className={fieldErrors.items ? "border-destructive" : ""}>
        <CardHeader>
          <CardTitle>Add Items</CardTitle>
          <CardDescription>
            Search and add products to your request
          </CardDescription>
          {fieldErrors.items && (
            <p className="text-xs text-destructive mt-2">{fieldErrors.items}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Product Search */}
          <div className="space-y-2">
            <Label>Select Product</Label>
            <ProductSearchCombobox
              products={products}
              onSelect={setSelectedProduct}
              disabled={false}
            />
            {selectedProduct && (
              <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                <div>
                  <p className="font-medium">{selectedProduct.name}</p>
                  <p className="text-sm text-muted-foreground">
                    SKU: {selectedProduct.SKU} • Available:{" "}
                    {getAvailableStock(selectedProduct)} {selectedProduct.unit}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedProduct(null)}
                >
                  <IconX className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {selectedProduct && (
            <>
              {/* Quantity */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantity">
                    Quantity <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    max={getAvailableStock(selectedProduct)}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Enter quantity"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="itemNotes">Item Notes</Label>
                  <Input
                    id="itemNotes"
                    value={itemNotes}
                    onChange={(e) => setItemNotes(e.target.value)}
                    placeholder="Notes for this item (optional)..."
                  />
                </div>
              </div>

              {/* Add Button */}
              <Button
                type="button"
                onClick={handleAddItem}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black"
              >
                <IconPlus className="mr-2 h-4 w-4" />
                Add Item to Request
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Items List */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Request Items ({items.length})</CardTitle>
            <CardDescription>Review the items in your request</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Desktop Table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-sm text-muted-foreground">
                            SKU: {item.SKU}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.requestedQuantity} {item.unit}
                      </TableCell>
                      <TableCell>
                        {item.notes ? (
                          <span className="text-sm text-muted-foreground">{item.notes}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(
                          item.requestedQuantity * item.unitPrice
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-destructive"
                        >
                          <IconTrash className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-4">
              {items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-sm text-muted-foreground">
                            SKU: {item.SKU}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-destructive"
                        >
                          <IconTrash className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-muted-foreground">Quantity</p>
                          <p className="font-medium">
                            {item.requestedQuantity} {item.unit}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Value</p>
                          <p className="font-medium">
                            {formatCurrency(
                              item.requestedQuantity * item.unitPrice
                            )}
                          </p>
                        </div>
                      </div>

                      {item.notes && (
                        <p className="text-sm text-muted-foreground">{item.notes}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Summary */}
            <div className="mt-6 p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Items:</span>
                <span className="font-medium">{totalItems} units</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Total Value:</span>
                <span className="text-yellow-600">
                  {formatCurrency(totalValue)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col-reverse sm:flex-row gap-4 justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={items.length === 0 || isPending}
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
        >
          {isPending ? "Submitting..." : "Submit Request"}
        </Button>
      </div>
    </form>
  );
}
