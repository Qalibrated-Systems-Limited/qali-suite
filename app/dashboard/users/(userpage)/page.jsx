import { Suspense } from "react";
import {
  searchUsersPg,
  getUserStatsPg,
  getDepartmentsPg,
} from "@/app/db/actions/user-actions";
import { auth } from "@/auth";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import { MetricBar } from "@/components/metric-bar";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Users, UserCheck, UserX, Shield } from "lucide-react";
import {
  UserRoleFilter,
  UserStatusFilter,
  UserDepartmentFilter,
  UserCompanyFilter,
  ClearUserFiltersButton,
  UserFilterBadge,
} from "../components/UserFilters";
import InviteUserDialog from "../components/InviteUserDialog";
import InvitesList from "../components/InvitesList";
import { getCompanyInvitesPg } from "@/app/db/actions/invite-actions";
import { listCompaniesForDropdown as getCompaniesForDropdown } from "@/app/db/platform";
import { UsersTable } from "../components/UserTable";
import { UsersTableSkeleton } from "../components/UserSkeleton";

async function UsersPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();
  const { user } = session;

  const query = searchParams.query || "";
  const role = searchParams.role || "all";
  const status = searchParams.status || "all";
  const department = searchParams.department || "all";
  const companyIdFilter = searchParams.companyId || "all";
  const currentPage = Number(searchParams.page) || 1;

  // Check permissions
  const canManageUsers = user?.role === "Admin" || user?.role === "SuperAdmin";

  if (!canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full bg-card border-border">
          <CardContent className="pt-6 text-center space-y-4">
            <Shield className="h-12 w-12 mx-auto text-red-600 dark:text-red-400" />
            <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
            <p className="text-muted-foreground">
              You don't have permission to view users. Only Administrators and
              Store Managers can access this page.
            </p>
            <Button asChild variant="outline" className="border-border">
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // SuperAdmin = cross-tenant access regardless of companyId on the user
  // record. This matches getTenantContext()'s contract.
  const isSuperAdmin = user?.role === "SuperAdmin";

  // Build filters object. companyId filter only applies for SuperAdmin —
  // non-SuperAdmins are tenant-scoped server-side regardless.
  const filters = {
    role: role !== "all" ? role : "",
    status: status !== "all" ? status : "",
    department: department !== "all" ? department : "",
    companyId: isSuperAdmin && companyIdFilter !== "all" ? companyIdFilter : "",
  };

  // Fetch the lightweight shell data (stats, invites, filter options) up front.
  // The users table + its pagination count are the heaviest queries here and
  // are unrelated to inviting/cancelling a user — so they're streamed via the
  // <Suspense> boundary below instead of blocking. This keeps the post-invite
  // revalidation (which the "Sending…" spinner waits on) fast.
  // getCompanyInvitesPg returns the rows directly — the Mongo action wrapped
  // them in { invites }.
  const [stats, departments, invites, companies] = await Promise.all([
    // Company-wide, deliberately unfiltered: the strip summarises the
    // company while the table below answers the filters. `getUserStatsPg`
    // never took an argument — the `filters` passed here was dropped on the
    // floor, which is what made it look filtered.
    getUserStatsPg(),
    getDepartmentsPg(),
    getCompanyInvitesPg(),
    isSuperAdmin ? getCompaniesForDropdown() : Promise.resolve([]),
  ]);

  // Resolve company name for active-filter badge (SuperAdmin only).
  const activeCompanyName =
    isSuperAdmin && companyIdFilter !== "all"
      ? companies.find((c) => c._id === companyIdFilter)?.name
      : null;

  // Check if any filters are active
  const hasActiveFilters =
    role !== "all" ||
    status !== "all" ||
    department !== "all" ||
    (isSuperAdmin && companyIdFilter !== "all");

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
            Users
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        <InviteUserDialog isSuperAdmin={isSuperAdmin} />
      </div>

      {/* Four figures the page never showed: `getUserStats` returns
          { total, active, inactive, admins } and this read `stats.totalUsers`,
          `activeUsers`, `inactiveUsers` and `adminCount` — names that have
          never existed on it, so all four rendered blank. */}
      <MetricBar
        items={[
          { label: "Users", value: stats.total },
          // Every figure that names a subset filters to it — the same rule the
          // stock bar follows. `status` is the page's own filter param, so
          // these land on a list that matches the number clicked.
          {
            label: "Active",
            value: stats.active,
            href: "?status=active",
            tone: "success",
          },
          {
            label: "Inactive",
            value: stats.inactive,
            href: "?status=inactive",
            tone: stats.inactive > 0 ? "warn" : "muted",
          },
          {
            label: "Admins",
            value: stats.admins,
            href: "?role=Admin",
          },
        ]}
      />

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by name, email, or department..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              {isSuperAdmin && (
                <UserCompanyFilter
                  currentCompanyId={companyIdFilter}
                  companies={companies}
                />
              )}
              <UserRoleFilter currentRole={role} />
              <UserStatusFilter currentStatus={status} />
              <UserDepartmentFilter
                currentDepartment={department}
                departments={departments}
              />
              {hasActiveFilters && <ClearUserFiltersButton />}
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {role !== "all" && (
                  <UserFilterBadge label="Role" value={role} param="role" />
                )}
                {status !== "all" && (
                  <UserFilterBadge
                    label="Status"
                    value={status}
                    param="status"
                  />
                )}
                {department !== "all" && (
                  <UserFilterBadge
                    label="Department"
                    value={department}
                    param="department"
                  />
                )}
                {isSuperAdmin && companyIdFilter !== "all" && (
                  <UserFilterBadge
                    label="Company"
                    value={activeCompanyName || companyIdFilter}
                    param="companyId"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invites */}
      <InvitesList invites={invites} />

      {/* Users Table — streamed so its heavy list + count queries don't block
          the rest of the page (incl. the post-invite revalidation). */}
      <Suspense fallback={<UsersTableSkeleton />}>
        <UsersTableSection
          query={query}
          currentPage={currentPage}
          filters={filters}
          user={user}
          isSuperAdmin={isSuperAdmin}
        />
      </Suspense>
    </div>
  );
}

// Streamed table section: the table rows and pagination count are the most
// expensive queries on this page. Isolating them behind Suspense lets the page
// shell (stats, invites, filters) render immediately and lets revalidatePath
// refreshes return without waiting on this work.
async function UsersTableSection({ query, currentPage, filters, user, isSuperAdmin }) {
  // One query for the page and its total — searchUsersPg returns both, so the
  // separate count fetchUserPages did is gone.
  const { rows: users, pages: totalPages } = await searchUsersPg({
    query,
    page: currentPage,
    ...filters,
  });

  return (
    <>
      <UsersTable users={users} currentUser={user} isSuperAdmin={isSuperAdmin} />

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </>
  );
}

export default UsersPage;
