"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Edit,
  Eye,
  Power,
  PowerOff,
  Trash2,
  Building,
  Mail,
  Phone,
  MoreVertical,
  FileText,
  ShoppingCart,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  togglePartyStatus,
  deleteParty,
} from "@/app/mongodb/actions/party-actions";
import { toast } from "sonner";

export default function SupplierListClient({ suppliers }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggleStatus = async (supplierId, newStatus) => {
    startTransition(async () => {
      const result = await togglePartyStatus(supplierId, newStatus);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to update status");
      }
    });
  };

  const handleDelete = async (supplierId, supplierName) => {
    if (!confirm(`Are you sure you want to delete ${supplierName}?`)) return;

    startTransition(async () => {
      const result = await deleteParty(supplierId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to delete supplier");
      }
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(amount || 0);
  };

  return (
    <div className="space-y-4">
      {/* Desktop Table View */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Tax PIN</TableHead>
                <TableHead>WHT</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Building className="h-8 w-8" />
                      <p>No suppliers found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                suppliers.map((supplier) => (
                  <TableRow key={supplier._id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-foreground">
                          {supplier.name}
                        </div>
                        {supplier.displayName && (
                          <div className="text-sm text-muted-foreground">
                            {supplier.displayName}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm space-y-0.5">
                        {supplier.email && (
                          <div className="text-foreground">{supplier.email}</div>
                        )}
                        {supplier.phone && (
                          <div className="text-muted-foreground">
                            {supplier.phone}
                          </div>
                        )}
                        {!supplier.email && !supplier.phone && (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {supplier.taxPin || "-"}
                    </TableCell>
                    <TableCell>
                      {supplier.whtApplicable ? (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                          {supplier.whtRate || 0}%
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-medium ${
                          supplier.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : supplier.cachedBalance < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(supplier.cachedBalance)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          supplier.isActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800"
                        }
                      >
                        {supplier.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isPending}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/parties/${supplier._id}`}
                              className="cursor-pointer"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/parties/${supplier._id}/edit`}
                              className="cursor-pointer"
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/purchase-orders/create?supplier=${supplier._id}`}
                              className="cursor-pointer"
                            >
                              <ShoppingCart className="mr-2 h-4 w-4" />
                              Create PO
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/bills/create?supplier=${supplier._id}`}
                              className="cursor-pointer"
                            >
                              <FileText className="mr-2 h-4 w-4" />
                              Create Bill
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() =>
                              handleToggleStatus(supplier._id, !supplier.isActive)
                            }
                            disabled={isPending}
                            className={
                              supplier.isActive
                                ? "text-orange-600 cursor-pointer"
                                : "text-green-600 cursor-pointer"
                            }
                          >
                            {supplier.isActive ? (
                              <>
                                <PowerOff className="mr-2 h-4 w-4" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <Power className="mr-2 h-4 w-4" />
                                Activate
                              </>
                            )}
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() =>
                              handleDelete(supplier._id, supplier.name)
                            }
                            disabled={isPending}
                            className="text-destructive cursor-pointer"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="space-y-4 md:hidden">
        {suppliers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Building className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No suppliers found</p>
            </CardContent>
          </Card>
        ) : (
          suppliers.map((supplier) => (
            <Card key={supplier._id}>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {supplier.name}
                      </h3>
                      {supplier.displayName && (
                        <p className="text-sm text-muted-foreground truncate">
                          {supplier.displayName}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        supplier.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }
                    >
                      {supplier.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-2 text-sm">
                    {supplier.email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{supplier.email}</span>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4 flex-shrink-0" />
                        <span>{supplier.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-3 gap-2 text-sm pt-2 border-t border-border">
                    <div>
                      <p className="text-muted-foreground text-xs">Tax PIN</p>
                      <p className="font-medium">{supplier.taxPin || "-"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">WHT</p>
                      <p className="font-medium">
                        {supplier.whtApplicable ? `${supplier.whtRate || 0}%` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Balance</p>
                      <p
                        className={`font-medium ${
                          supplier.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : supplier.cachedBalance < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(supplier.cachedBalance)}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      asChild
                    >
                      <Link href={`/dashboard/parties/${supplier._id}`}>
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      asChild
                    >
                      <Link href={`/dashboard/parties/${supplier._id}/edit`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleToggleStatus(supplier._id, !supplier.isActive)
                      }
                      disabled={isPending}
                      className={
                        supplier.isActive ? "text-orange-600" : "text-green-600"
                      }
                    >
                      {supplier.isActive ? (
                        <PowerOff className="h-4 w-4" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(supplier._id, supplier.name)}
                      disabled={isPending}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
