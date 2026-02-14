import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  getUniqueReasons,
  getUniqueTechnicians,
} from "@/app/mongodb/queries/dnote-queries";
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
import {
  DnoteStatsCards,
  DnoteStatsSkeleton,
  DnotesTableServer,
  DnotesTableSkeleton,
  DnotesPaginationServer,
  PaginationSkeleton,
} from "../components/DnoteServerComponents";

async function DeliveryNotesPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

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

  // Fetch filter options (needed for dropdowns)
  const [reasons, technicians] = await Promise.all([
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

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<DnoteStatsSkeleton />}>
        <DnoteStatsCards />
      </Suspense>

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

      {/* Delivery Notes Table - Stream independently */}
      <Suspense fallback={<DnotesTableSkeleton />}>
        <DnotesTableServer query={query} page={currentPage} filters={filters} />
      </Suspense>

      {/* Pagination - Stream independently */}
      <Suspense fallback={<PaginationSkeleton />}>
        <DnotesPaginationServer query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

export default DeliveryNotesPage;
