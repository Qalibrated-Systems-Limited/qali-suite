"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
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
import { cn } from "@/lib/utils";

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
            filteredProducts.map((product) => (
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
                    SKU: {product.SKU} • Stock: {product.stock} {product.unit}
                  </p>
                </div>
                {product.stock === 0 && (
                  <Badge variant="destructive" className="ml-2">
                    Out of Stock
                  </Badge>
                )}
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
  user,
  createRequestAction,
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(createRequestAction, {
    message: "",
  });

  // Form state
  const [customer, setCustomer] = useState("");
  const [priority, setPriority] = useState("normal");
  const [requiredByDate, setRequiredByDate] = useState();
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([]);

  // Item being added
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeDetails, setPurposeDetails] = useState("");
  const [requiresReturn, setRequiresReturn] = useState(false);
  const [expectedReturnDate, setExpectedReturnDate] = useState();
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

    if (!purpose) {
      alert("Please select a purpose");
      return;
    }

    const qty = parseInt(quantity);

    if (qty > selectedProduct.stock) {
      alert(
        `Only ${selectedProduct.stock} ${selectedProduct.unit} available in stock`
      );
      return;
    }

    const newItem = {
      id: Date.now(), // Temporary ID
      productId: selectedProduct._id,
      productName: selectedProduct.name,
      SKU: selectedProduct.SKU,
      currentStock: selectedProduct.stock,
      requestedQuantity: qty,
      unitPrice: selectedProduct.price || 0,
      unit: selectedProduct.unit,
      purpose,
      purposeDetails,
      requiresReturn: purpose !== "sale" && requiresReturn,
      expectedReturnDate: requiresReturn ? expectedReturnDate : null,
      notes: itemNotes,
    };

    setItems([...items, newItem]);

    // Reset item form
    setSelectedProduct(null);
    setQuantity("");
    setPurpose("");
    setPurposeDetails("");
    setRequiresReturn(false);
    setExpectedReturnDate(undefined);
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
  // HANDLE SUCCESS
  // ============================================
  useEffect(() => {
    if (state.message === "success") {
      router.push("/dashboard/requests");
      router.refresh();
    }
  }, [state.message, router]);

  // ============================================
  // SUBMIT FORM
  // ============================================
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (items.length === 0) {
      alert("Please add at least one item to the request");
      return;
    }

    if (!customer.trim()) {
      alert("Please enter customer name");
      return;
    }

    const formData = new FormData();
    formData.append("customer", customer);
    formData.append("priority", priority);
    formData.append("notes", notes);
    if (requiredByDate) {
      formData.append("requiredByDate", requiredByDate.toISOString());
    }

    // Add items as JSON
    formData.append("items", JSON.stringify(items));

    await formAction(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Message */}
      {state.message && state.message !== "success" && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <IconAlertCircle className="h-5 w-5" />
              <p>{state.message}</p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Customer */}
            <div className="space-y-2">
              <Label htmlFor="customer">
                Customer / Project <span className="text-destructive">*</span>
              </Label>
              <Input
                id="customer"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="Enter customer name or project"
                required
              />
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
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
                    disabled={(date) => date < new Date()}
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
            />
          </div>
        </CardContent>
      </Card>

      {/* Add Items Section */}
      <Card>
        <CardHeader>
          <CardTitle>Add Items</CardTitle>
          <CardDescription>
            Search and add products to your request
          </CardDescription>
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
                    {selectedProduct.stock} {selectedProduct.unit}
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
              {/* Quantity and Purpose */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantity">
                    Quantity <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    max={selectedProduct.stock}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Enter quantity"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purpose">
                    Purpose <span className="text-destructive">*</span>
                  </Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sale">Sale to Customer</SelectItem>
                      <SelectItem value="customer_demo">
                        Customer Demo
                      </SelectItem>
                      <SelectItem value="technician_test">
                        Technician Testing
                      </SelectItem>
                      <SelectItem value="installation">Installation</SelectItem>
                      <SelectItem value="repair">Repair/Maintenance</SelectItem>
                      <SelectItem value="internal_use">Internal Use</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Purpose Details */}
              <div className="space-y-2">
                <Label htmlFor="purposeDetails">Purpose Details</Label>
                <Input
                  id="purposeDetails"
                  value={purposeDetails}
                  onChange={(e) => setPurposeDetails(e.target.value)}
                  placeholder="Provide more details about the purpose..."
                />
              </div>

              {/* Return Info (if not sale) */}
              {purpose && purpose !== "sale" && (
                <div className="space-y-4 p-4 bg-muted rounded-md">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="requiresReturn"
                      checked={requiresReturn}
                      onChange={(e) => setRequiresReturn(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="requiresReturn" className="cursor-pointer">
                      This item requires return
                    </Label>
                  </div>

                  {requiresReturn && (
                    <div className="space-y-2">
                      <Label>Expected Return Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !expectedReturnDate && "text-muted-foreground"
                            )}
                          >
                            <IconCalendar className="mr-2 h-4 w-4" />
                            {expectedReturnDate ? (
                              format(expectedReturnDate, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={expectedReturnDate}
                            onSelect={setExpectedReturnDate}
                            initialFocus
                            disabled={(date) => date < new Date()}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
              )}

              {/* Item Notes */}
              <div className="space-y-2">
                <Label htmlFor="itemNotes">Item Notes</Label>
                <Textarea
                  id="itemNotes"
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Any specific notes for this item..."
                  rows={2}
                />
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
                    <TableHead>Purpose</TableHead>
                    <TableHead>Return?</TableHead>
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
                        <Badge variant="outline">{item.purpose}</Badge>
                      </TableCell>
                      <TableCell>
                        {item.requiresReturn ? (
                          <Badge variant="secondary">Yes</Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
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

                      <div className="flex gap-2">
                        <Badge variant="outline">{item.purpose}</Badge>
                        {item.requiresReturn && (
                          <Badge variant="secondary">Requires Return</Badge>
                        )}
                      </div>
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
          disabled={items.length === 0}
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
        >
          Submit Request
        </Button>
      </div>
    </form>
  );
}
