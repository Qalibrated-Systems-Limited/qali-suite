import { Suspense } from "react";
import {
  searchUsers,
  fetchUserPages,
  getUserStats,
  getDepartments,
} from "@/app/mongodb/queries/user-queries";
import { auth } from "@/auth";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
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
import { getCompanyInvites } from "@/app/mongodb/actions/invite-actions";
import { getCompaniesForDropdown } from "@/app/mongodb/queries/company-queries";
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

  // Fetch data in parallel
  const [totalPages, users, stats, departments, { invites }, companies] = await Promise.all([
    fetchUserPages(query, filters),
    searchUsers(query, currentPage, filters),
    getUserStats(filters),
    getDepartments(),
    getCompanyInvites(),
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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Users</h1>
          <p className="text-muted-foreground mt-1">
            Manage user accounts and permissions
          </p>
        </div>
        <InviteUserDialog isSuperAdmin={isSuperAdmin} companies={companies} />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Total Users
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {stats.totalUsers}
                </p>
              </div>
              <Users className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Active</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.activeUsers}
                </p>
              </div>
              <UserCheck className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Inactive</p>
                <p className="text-2xl font-bold text-gray-500">
                  {stats.inactiveUsers}
                </p>
              </div>
              <UserX className="w-8 h-8 text-gray-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Admins</p>
                <p className="text-2xl font-bold text-red-500">
                  {stats.adminCount}
                </p>
              </div>
              <Shield className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* Users Table */}
      <Suspense fallback={<UsersTableSkeleton />}>
        <UsersTable users={users} currentUser={user} isSuperAdmin={isSuperAdmin} />
      </Suspense>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default UsersPage;
