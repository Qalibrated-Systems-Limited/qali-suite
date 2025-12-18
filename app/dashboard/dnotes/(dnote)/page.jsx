import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  searchDeliveryNotes,
  fetchDeliveryNotePages,
  getDeliveryNotesStats,
  getUniqueReasons,
  getUniqueTechnicians,
} from "@/app/mongodb/queries/dnote-queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  ReturnTypeFilter,
  ReasonFilter,
  TechnicianFilter,
  DNoteDateFilter,
  ClearDNoteFiltersButton,
  DNoteFilterBadge,
} from "../components/DeliveryNoteFilters";
import { DeliveryNotesTable } from "../components/DeliveryNoteTable";
import {
  FileText,
  PackageCheck,
  TruckIcon,
  Calendar,
  DollarSign,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

async function DeliveryNotesPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Get URL parameters
  const query = searchParams.query || "";
  const returnType = searchParams.returnType || "all";
  const reason = searchParams.reason || "all";
  const technician = searchParams.technician || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const currentPage = Number(searchParams.page) || 1;

  // Build filters object
  const filters = {
    returnType: returnType !== "all" ? returnType : "",
    reason: reason !== "all" ? reason : "",
    technician,
    startDate,
    endDate,
  };

  // Fetch data in parallel
  const [totalPages, deliveryNotes, stats, reasons, technicians] =
    await Promise.all([
      fetchDeliveryNotePages(query, filters),
      searchDeliveryNotes(query, currentPage, filters),
      getDeliveryNotesStats(),
      getUniqueReasons(),
      getUniqueTechnicians(),
    ]);

  // Check if any filters are active
  const hasActiveFilters =
    returnType !== "all" ||
    reason !== "all" ||
    technician ||
    startDate ||
    endDate;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Delivery Notes</h1>
          <p className="text-muted-foreground">
            Manage delivery notes for sales and returnable items
          </p>
        </div>
      </div>

      {/* Stats Cards
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total DNotes</p>
                <p className="text-2xl font-bold text-foreground">
                  {stats.total}
                </p>
              </div>
              <FileText className="w-8 h-8 text-yellow-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-sm font-semibold text-yellow-400">
                {formatCurrency(stats.salesValue + stats.returnableValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Sales</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.sales}
                </p>
              </div>
              <PackageCheck className="w-8 h-8 text-green-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Sales Value</p>
              <p className="text-sm font-semibold text-green-400">
                {formatCurrency(stats.salesValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Returnable</p>
                <p className="text-2xl font-bold text-orange-500">
                  {stats.returnable}
                </p>
              </div>
              <TruckIcon className="w-8 h-8 text-orange-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Returnable Value</p>
              <p className="text-sm font-semibold text-orange-400">
                {formatCurrency(stats.returnableValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">This Month</p>
                <p className="text-2xl font-bold text-blue-500">
                  {stats.thisMonth}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-blue-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Month Value</p>
              <p className="text-sm font-semibold text-blue-400">
                {formatCurrency(stats.thisMonthValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Avg. Value</p>
                <p className="text-2xl font-bold text-purple-500">
                  {stats.total > 0
                    ? formatCurrency(
                        (stats.salesValue + stats.returnableValue) / stats.total
                      )
                    : "KES 0"}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-purple-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Sales Ratio</p>
              <p className="text-sm font-semibold text-purple-400">
                {stats.total > 0
                  ? Math.round((stats.sales / stats.total) * 100)
                  : 0}
                %
              </p>
            </div>
          </CardContent>
        </Card>
      </div> */}

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by DN#, customer, technician..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <ReturnTypeFilter currentType={returnType} />
                <ReasonFilter currentReason={reason} reasons={reasons} />
                <TechnicianFilter
                  currentTechnician={technician}
                  technicians={technicians}
                />
                {hasActiveFilters && <ClearDNoteFiltersButton />}
              </div>

              {/* Date Range Filter */}
              <DNoteDateFilter startDate={startDate} endDate={endDate} />
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {returnType !== "all" && (
                  <DNoteFilterBadge
                    label="Type"
                    value={returnType}
                    param="returnType"
                  />
                )}
                {reason !== "all" && (
                  <DNoteFilterBadge
                    label="Reason"
                    value={reason}
                    param="reason"
                  />
                )}
                {technician && (
                  <DNoteFilterBadge
                    label="Technician"
                    value={technician}
                    param="technician"
                  />
                )}
                {startDate && (
                  <DNoteFilterBadge
                    label="From"
                    value={startDate}
                    param="startDate"
                  />
                )}
                {endDate && (
                  <DNoteFilterBadge
                    label="To"
                    value={endDate}
                    param="endDate"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delivery Notes Table */}
      <DeliveryNotesTable deliveryNotes={deliveryNotes} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default DeliveryNotesPage;
