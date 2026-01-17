import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Power,
  PowerOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { getPartyById } from "@/app/mongodb/queries/partyQueries";
import { getUsers } from "@/app/mongodb/queries/partyQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LinkUserDialog } from "./linkUserDialog";
import { ToggleStatusButton, DeletePartyButton } from "./actionButtons";
import { auth } from "@/auth";

export const metadata = {
  title: "Party Details | ERP System",
};

export default async function PartyDetailPage({ id }) {
  const session = await auth();
  const { user } = session;

  // Fetch party
  const party = await getPartyById(id);

  if (!party) {
    notFound();
  }

  // Fetch users for linking (only if employee)
  let users = [];
  if (party.type === "employee") {
    users = await getUsers(); // Get all active users
  }

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(amount);
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/parties">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{party.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {party.displayName && `(${party.displayName})`}
            </p>
          </div>
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

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {party.type === "employee" && (
            <LinkUserDialog party={party} users={users} />
          )}

          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/parties/${party._id}/edit`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Link>
          </Button>

          <ToggleStatusButton party={party} />
          <DeletePartyButton party={party} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Left Side */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{party.email || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium">{party.phone || "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Tax PIN (KRA)</p>
                <p className="font-medium">{party.taxPin || "—"}</p>
              </div>
            </CardContent>
          </Card>

          {/* Employee Details */}
          {party.type === "employee" && (
            <Card>
              <CardHeader>
                <CardTitle>Employee Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Employee Number
                  </p>
                  <p className="font-medium">{party.employeeNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Department</p>
                  <p className="font-medium">{party.department || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Designation</p>
                  <p className="font-medium">{party.designation || "—"}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Supplier Details */}
          {(party.type === "supplier" || party.type === "both") && (
            <Card>
              <CardHeader>
                <CardTitle>Supplier/Contractor Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Is Contractor
                    </p>
                    <p className="font-medium">
                      {party.isContractor ? "Yes" : "No"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      WHT Applicable
                    </p>
                    <p className="font-medium">
                      {party.whtApplicable ? "Yes" : "No"}
                    </p>
                  </div>
                  {party.whtApplicable && (
                    <div>
                      <p className="text-sm text-muted-foreground">WHT Rate</p>
                      <p className="font-medium">{party.whtRate}%</p>
                    </div>
                  )}
                </div>

                {party.paymentDetails && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">
                        Bank Details
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Bank Name
                          </p>
                          <p className="font-medium">
                            {party.paymentDetails.bankName || "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Account Number
                          </p>
                          <p className="font-medium">
                            {party.paymentDetails.accountNumber || "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Customer Details */}
          {(party.type === "customer" || party.type === "both") &&
            party.creditTerms && (
              <Card>
                <CardHeader>
                  <CardTitle>Credit Terms</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Credit Limit
                    </p>
                    <p className="font-medium text-lg">
                      {formatCurrency(party.creditTerms.creditLimit || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Payment Terms
                    </p>
                    <p className="font-medium">
                      {party.creditTerms.paymentTermsDays || 0} days
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Notes */}
          {party.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{party.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar - Right Side */}
        <div className="space-y-6">
          {/* Financial Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Financial Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Current Balance</p>
                <p
                  className={`text-2xl font-bold ${
                    party.cachedBalance > 0
                      ? "text-green-600 dark:text-green-400"
                      : party.cachedBalance < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatCurrency(party.cachedBalance)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {party.cachedBalance > 0
                    ? "They owe us"
                    : party.cachedBalance < 0
                    ? "We owe them"
                    : "No outstanding balance"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Linked User */}
          {party.type === "employee" && party.userId && (
            <Card>
              <CardHeader>
                <CardTitle>Linked User Account</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {users.find((u) => u._id === party.userId)?.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {users.find((u) => u._id === party.userId)?.email}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="bg-green-100 text-green-800"
                  >
                    Linked
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">{formatDate(party.createdAt)}</p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground">Last Updated</p>
                <p className="font-medium">{formatDate(party.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
