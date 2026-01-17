"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Edit,
  Eye,
  Power,
  PowerOff,
  Trash2,
  Users,
  Building,
  UserCheck,
  Mail,
  Phone,
  MoreVertical,
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

const TABS = [
  { value: "all", label: "All", icon: Users },
  { value: "customer", label: "Customers", icon: Users },
  { value: "supplier", label: "Suppliers", icon: Building },
  { value: "employee", label: "Employees", icon: UserCheck },
];

export default function PartyListClient({ parties, currentType }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Handle type filter
  const handleTypeChange = (type) => {
    const params = new URLSearchParams(searchParams);
    if (type === "all") {
      params.delete("type");
    } else {
      params.set("type", type);
    }
    params.set("page", "1");
    router.push(`/dashboard/parties?${params.toString()}`);
  };

  // Handle toggle status - FIXED TO CALL DIRECTLY
  const handleToggleStatus = async (partyId, newStatus) => {
    startTransition(async () => {
      const result = await togglePartyStatus(partyId, newStatus);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to update status");
      }
    });
  };

  // Handle delete - FIXED TO CALL DIRECTLY
  const handleDelete = async (partyId, partyName) => {
    if (!confirm(`Are you sure you want to delete ${partyName}?`)) return;

    startTransition(async () => {
      const result = await deleteParty(partyId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to delete party");
      }
    });
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(amount);
  };

  return (
    <div className="space-y-4">
      {/* Tabs - Responsive scroll on mobile */}
      <div className="border-b border-border overflow-x-auto">
        <div className="flex gap-2 sm:gap-4 min-w-max">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentType === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => handleTypeChange(tab.value)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-3 border-b-2 transition whitespace-nowrap ${
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm sm:text-base">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ============================================
          DESKTOP TABLE VIEW
          ============================================ */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Party</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Tax PIN</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="h-8 w-8" />
                      <p>No parties found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                parties.map((party) => (
                  <TableRow key={party._id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-foreground">
                          {party.name}
                        </div>
                        {party.displayName && (
                          <div className="text-sm text-muted-foreground">
                            {party.displayName}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          party.type === "customer"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                            : party.type === "supplier"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800"
                            : party.type === "employee"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800"
                            : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700"
                        }
                      >
                        {party.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm space-y-0.5">
                        {party.email && (
                          <div className="text-foreground">{party.email}</div>
                        )}
                        {party.phone && (
                          <div className="text-muted-foreground">
                            {party.phone}
                          </div>
                        )}
                        {!party.email && !party.phone && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {party.taxPin || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-medium ${
                          party.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : party.cachedBalance < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(party.cachedBalance)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          party.isActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800"
                        }
                      >
                        {party.isActive ? "Active" : "Inactive"}
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
                              href={`/dashboard/parties/${party._id}`}
                              className="cursor-pointer"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/parties/${party._id}/edit`}
                              className="cursor-pointer"
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() =>
                              handleToggleStatus(party._id, !party.isActive)
                            }
                            disabled={isPending}
                            className={
                              party.isActive
                                ? "text-orange-600 cursor-pointer"
                                : "text-green-600 cursor-pointer"
                            }
                          >
                            {party.isActive ? (
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
                            onClick={() => handleDelete(party._id, party.name)}
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

      {/* ============================================
          MOBILE CARD VIEW
          ============================================ */}
      <div className="space-y-4 md:hidden">
        {parties.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No parties found</p>
            </CardContent>
          </Card>
        ) : (
          parties.map((party) => (
            <Card key={party._id}>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {party.name}
                      </h3>
                      {party.displayName && (
                        <p className="text-sm text-muted-foreground truncate">
                          {party.displayName}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        party.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }
                    >
                      {party.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  {/* Type Badge */}
                  <div>
                    <Badge
                      variant="outline"
                      className={
                        party.type === "customer"
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                          : party.type === "supplier"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : party.type === "employee"
                          ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                          : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400"
                      }
                    >
                      {party.type}
                    </Badge>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-2 text-sm">
                    {party.email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{party.email}</span>
                      </div>
                    )}
                    {party.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4 flex-shrink-0" />
                        <span>{party.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-border">
                    <div>
                      <p className="text-muted-foreground text-xs">Tax PIN</p>
                      <p className="font-medium">{party.taxPin || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Balance</p>
                      <p
                        className={`font-medium ${
                          party.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : party.cachedBalance < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(party.cachedBalance)}
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
                      <Link href={`/dashboard/parties/${party._id}`}>
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
                      <Link href={`/dashboard/parties/${party._id}/edit`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleToggleStatus(party._id, !party.isActive)
                      }
                      disabled={isPending}
                      className={
                        party.isActive ? "text-orange-600" : "text-green-600"
                      }
                    >
                      {party.isActive ? (
                        <PowerOff className="h-4 w-4" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(party._id, party.name)}
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
