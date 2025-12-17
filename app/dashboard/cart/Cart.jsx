import {
  AddSingleCartVersion,
  RemoveCartItem,
  RemoveSingleCartVersion,
} from "../stocks/addToCartForm";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconShoppingCart } from "@tabler/icons-react";

import { RequestDialog } from "../components/requestDialog";

export async function CartComp({ cart }) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const cartTotal = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (cart.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <IconShoppingCart className="h-16 w-16 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">Your cart is empty</h3>
          <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
            Add items from the inventory to create a stock request
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cart Summary Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Shopping Cart</h2>
          <p className="text-sm text-muted-foreground">
            {totalItems} item(s) in cart
          </p>
        </div>
        <Badge variant="outline" className="text-base px-3 py-1">
          {formatCurrency(cartTotal)}
        </Badge>
      </div>

      {/* Desktop Table View */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">SKU</TableHead>
              <TableHead className="font-semibold">Product Name</TableHead>
              <TableHead className="font-semibold text-right">
                Unit Price
              </TableHead>
              <TableHead className="font-semibold text-center">
                Quantity
              </TableHead>
              <TableHead className="font-semibold text-right">
                Subtotal
              </TableHead>
              <TableHead className="font-semibold text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cart.map((item) => (
              <TableRow key={item._id}>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {item.id}
                </TableCell>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(item.unitPrice)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-center gap-1">
                    <div className="flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
                      <RemoveSingleCartVersion id={item.id} />
                      <span className="px-3 text-sm font-semibold text-primary min-w-[2ch] text-center">
                        {item.quantity}
                      </span>
                      <AddSingleCartVersion id={item.id} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatCurrency(item.unitPrice * item.quantity)}
                </TableCell>
                <TableCell className="text-right">
                  <RemoveCartItem id={item.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile Card View */}
      <div className="space-y-3 md:hidden">
        {cart.map((item) => (
          <Card key={item._id}>
            <CardContent className="p-4">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold">{item.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {item.id}
                    </p>
                  </div>
                  <RemoveCartItem id={item.id} />
                </div>

                {/* Price and Quantity */}
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <p className="text-muted-foreground text-xs">Unit Price</p>
                    <p className="font-semibold">
                      {formatCurrency(item.unitPrice)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
                    <RemoveSingleCartVersion id={item.id} />
                    <span className="px-3 text-sm font-semibold text-primary min-w-[2ch] text-center">
                      {item.quantity}
                    </span>
                    <AddSingleCartVersion id={item.id} />
                  </div>

                  <div className="text-sm text-right">
                    <p className="text-muted-foreground text-xs">Subtotal</p>
                    <p className="font-semibold">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cart Total & Actions */}
      <Card className="bg-muted/50">
        <CardContent className="p-6">
          <div className="space-y-4">
            {/* Total */}
            <div className="flex items-center justify-between text-lg">
              <span className="font-semibold">Total Amount:</span>
              <span className="text-2xl font-bold text-primary">
                {formatCurrency(cartTotal)}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <RequestDialog cart={cart} cartTotal={cartTotal} />
            </div>

            {/* Info Text */}
            <p className="text-xs text-muted-foreground text-center">
              Items will be sent for manager approval before dispatch
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
