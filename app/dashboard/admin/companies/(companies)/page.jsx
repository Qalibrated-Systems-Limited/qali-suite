import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  searchCompanies,
  fetchCompanyPages,
  getCompanyStats,
} from "@/app/mongodb/queries/company-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import CompanyListClient from "../components/companyListClient";

export const metadata = {
  title: "Companies",
  description: "Manage all companies",
};

export default async function CompaniesPage({ searchParams }) {
  const session = await auth();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "SuperAdmin") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-destructive">Not Authorized</h1>
          <p className="text-muted-foreground mt-2">
            Only SuperAdmin can manage companies.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const search = params?.search || "";
  const page = Number(params?.page) || 1;
  const status = params?.status || "all";
  const plan = params?.plan || "all";

  const [companies, totalPages, stats] = await Promise.all([
    searchCompanies(search, page, { status, plan }),
    fetchCompanyPages(search, { status, plan }),
    getCompanyStats(),
  ]);

  return (
    <div className="container space-y-4 py-2 sm:space-y-6 sm:py-6">
      {/* Header — compact on phones: the sticky header already shows the
          page title there, so the icon box + subtitle are sm+ only. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden rounded-lg bg-yellow-500/10 p-2 sm:block">
            <Building2 className="h-6 w-6 text-yellow-600" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-2xl">Companies</h1>
            <p className="hidden text-muted-foreground sm:block">
              Manage all tenant companies
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/dashboard/admin/companies/create">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Company</span>
          </Link>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <Card>
          <CardHeader className="p-3 pb-1 sm:p-4 sm:pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Companies
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-lg sm:text-xl font-bold">{stats.totalCompanies}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1 sm:p-4 sm:pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-lg sm:text-xl font-bold">{stats.activeCompanies}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1 sm:p-4 sm:pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              On Trial
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span className="text-lg sm:text-xl font-bold">{stats.trialCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1 sm:p-4 sm:pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Suspended
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-lg sm:text-xl font-bold">{stats.suspendedCompanies}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Companies List */}
      <CompanyListClient
        companies={companies}
        totalPages={totalPages}
        currentPage={page}
        search={search}
        status={status}
        plan={plan}
      />
    </div>
  );
}
