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
  Users,
  Mail,
  Phone,
  MoreVertical,
  FileText,
  Receipt,
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

export default function CustomerListClient({ customers }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggleStatus = async (customerId, newStatus) => {
    startTransition(async () => {
      const result = await togglePartyStatus(customerId, newStatus);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to update status");
      }
    });
  };

  const handleDelete = async (customerId, customerName) => {
    if (!confirm(`Are you sure you want to delete ${customerName}?`)) return;

    startTransition(async () => {
      const result = await deleteParty(customerId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to delete customer");
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
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Tax PIN</TableHead>
                <TableHead>Credit Limit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="h-8 w-8" />
                      <p>No customers found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer) => (
                  <TableRow key={customer._id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-foreground">
                          {customer.name}
                        </div>
                        {customer.displayName && (
                          <div className="text-sm text-muted-foreground">
                            {customer.displayName}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm space-y-0.5">
                        {customer.email && (
                          <div className="text-foreground">{customer.email}</div>
                        )}
                        {customer.phone && (
                          <div className="text-muted-foreground">
                            {customer.phone}
                          </div>
                        )}
                        {!customer.email && !customer.phone && (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {customer.taxPin || "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {customer.creditTerms?.creditLimit
                        ? formatCurrency(customer.creditTerms.creditLimit)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-medium ${
                          customer.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : customer.cachedBalance < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(customer.cachedBalance)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          customer.isActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800"
                        }
                      >
                        {customer.isActive ? "Active" : "Inactive"}
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
                              href={`/dashboard/parties/${customer._id}`}
                              className="cursor-pointer"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/parties/${customer._id}/edit`}
                              className="cursor-pointer"
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/quotes/create?customer=${customer._id}`}
                              className="cursor-pointer"
                            >
                              <FileText className="mr-2 h-4 w-4" />
                              Create Quote
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/invoices/create?customer=${customer._id}`}
                              className="cursor-pointer"
                            >
                              <Receipt className="mr-2 h-4 w-4" />
                              Create Invoice
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() =>
                              handleToggleStatus(customer._id, !customer.isActive)
                            }
                            disabled={isPending}
                            className={
                              customer.isActive
                                ? "text-orange-600 cursor-pointer"
                                : "text-green-600 cursor-pointer"
                            }
                          >
                            {customer.isActive ? (
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
                              handleDelete(customer._id, customer.name)
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
        {customers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No customers found</p>
            </CardContent>
          </Card>
        ) : (
          customers.map((customer) => (
            <Card key={customer._id}>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {customer.name}
                      </h3>
                      {customer.displayName && (
                        <p className="text-sm text-muted-foreground truncate">
                          {customer.displayName}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        customer.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }
                    >
                      {customer.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-2 text-sm">
                    {customer.email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{customer.email}</span>
                      </div>
                    )}
                    {customer.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4 flex-shrink-0" />
                        <span>{customer.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-border">
                    <div>
                      <p className="text-muted-foreground text-xs">Tax PIN</p>
                      <p className="font-medium">{customer.taxPin || "-"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Balance</p>
                      <p
                        className={`font-medium ${
                          customer.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : customer.cachedBalance < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(customer.cachedBalance)}
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
                      <Link href={`/dashboard/parties/${customer._id}`}>
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
                      <Link href={`/dashboard/parties/${customer._id}/edit`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleToggleStatus(customer._id, !customer.isActive)
                      }
                      disabled={isPending}
                      className={
                        customer.isActive ? "text-orange-600" : "text-green-600"
                      }
                    >
                      {customer.isActive ? (
                        <PowerOff className="h-4 w-4" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(customer._id, customer.name)}
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
