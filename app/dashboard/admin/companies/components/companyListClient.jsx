"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit,
  LogIn,
  Loader2,
} from "lucide-react";
import { switchToCompanyBySourceId } from "@/app/db/actions/company-switch-actions";

const statusColors = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  inactive: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  suspended: "bg-red-500/10 text-red-600 border-red-500/20",
};

const planColors = {
  free: "bg-gray-500/10 text-gray-600",
  starter: "bg-blue-500/10 text-blue-600",
  professional: "bg-purple-500/10 text-purple-600",
  enterprise: "bg-yellow-500/10 text-yellow-600",
};

export default function CompanyListClient({
  companies,
  totalPages,
  currentPage,
  search,
  status,
  plan,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isSwitching, startSwitch] = useTransition();

  /**
   * Enter a company rather than read about it.
   *
   * A SuperAdmin does not see across tenants — they hold a grant for each one
   * and work inside one at a time, under the same policies as anybody else in
   * it. This is how they get in: the grant is written if it is not already
   * there, the session moves onto that company, and every page that follows is
   * scoped to it.
   */
  const openCompany = (id, name) => {
    startSwitch(async () => {
      const result = await switchToCompanyBySourceId(id);
      if (!result?.ok) {
        toast.error(result?.error ?? "Could not open that company.");
        return;
      }
      toast.success(`Now operating as ${name}`);
      router.push("/dashboard");
    });
  };

  const updateUrl = (updates) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    // Reset to page 1 when filters change
    if (!updates.page) {
      params.delete("page");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSearch = useDebouncedCallback((term) => {
    updateUrl({ search: term });
  }, 300);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search companies..."
            defaultValue={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={(v) => updateUrl({ status: v })}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>

        <Select value={plan} onValueChange={(v) => updateUrl({ plan: v })}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plans</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="professional">Professional</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">No companies found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              companies.map((company) => {
                // The admin routes still carry the Mongo id; a tenant
                // provisioned straight into Postgres has none, so fall back to
                // the tenant uuid rather than linking to /undefined.
                const routeId = company.sourceId ?? company.id;
                return (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-yellow-600" />
                      </div>
                      <div>
                        <p className="font-medium">{company.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {company.city || "No location"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{company.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {company.phone || "-"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={planColors[company.plan] || ""}
                    >
                      {company.plan || "free"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusColors[company.status] || ""}
                    >
                      {company.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Operate as this company. Greyed out for one that is
                          not active, because the tenant gate refuses those —
                          a button that always fails is worse than no button. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        title={
                          company.status === "active"
                            ? `Operate as ${company.name}`
                            : "This company is not active"
                        }
                        disabled={isSwitching || company.status !== "active"}
                        onClick={() => openCompany(routeId, company.name)}
                      >
                        {isSwitching ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <LogIn className="h-4 w-4" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/dashboard/admin/companies/${routeId}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/dashboard/admin/companies/${routeId}/edit`}>
                          <Edit className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => updateUrl({ page: currentPage - 1 })}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => updateUrl({ page: currentPage + 1 })}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
