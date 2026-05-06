"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Filter, X } from "lucide-react";

// Role Filter
export function UserRoleFilter({ currentRole }) {
  return (
    <UserFilterSelect
      value={currentRole}
      param="role"
      placeholder="All Roles"
      options={[
        { value: "all", label: "All Roles" },
        { value: "SuperAdmin", label: "SuperAdmin" },
        { value: "Admin", label: "Admin" },
        { value: "Manager", label: "Manager" },
        { value: "Employee", label: "Employee" },
        { value: "Technician", label: "Technician" },
        { value: "Store Manager", label: "Store Manager" },
        { value: "Accountant", label: "Accountant" },
        { value: "User", label: "User" },
        { value: "Viewer", label: "Viewer" },
      ]}
    />
  );
}

// Status Filter
export function UserStatusFilter({ currentStatus }) {
  return (
    <UserFilterSelect
      value={currentStatus}
      param="status"
      placeholder="All Status"
      options={[
        { value: "all", label: "All Status" },
        { value: "Active", label: "Active" },
        { value: "Inactive", label: "Inactive" },
      ]}
    />
  );
}

// Company Filter (SuperAdmin only)
export function UserCompanyFilter({ currentCompanyId, companies }) {
  const options = [
    { value: "all", label: "All Companies" },
    ...companies.map((c) => ({ value: c._id, label: c.name })),
  ];

  return (
    <UserFilterSelect
      value={currentCompanyId || "all"}
      param="companyId"
      placeholder="All Companies"
      options={options}
    />
  );
}

// Department Filter
export function UserDepartmentFilter({ currentDepartment, departments }) {
  const options = [
    { value: "all", label: "All Departments" },
    ...departments.map((dept) => ({ value: dept, label: dept })),
  ];

  return (
    <UserFilterSelect
      value={currentDepartment}
      param="department"
      placeholder="All Departments"
      options={options}
    />
  );
}

// Reusable Filter Select
function UserFilterSelect({ value, param, placeholder, options }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleChange = (newValue) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (newValue === "all") {
      params.delete(param);
    } else {
      params.set(param, newValue);
    }

    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="w-full sm:w-[180px] bg-background border-border text-foreground focus:border-yellow-500 focus:ring-yellow-500">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <SelectValue placeholder={placeholder} />
        </div>
      </SelectTrigger>
      <SelectContent className="bg-card border-border">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-foreground focus:bg-accent focus:text-foreground"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Clear Filters Button
export function ClearUserFiltersButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleClear = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("role");
    params.delete("status");
    params.delete("department");
    params.delete("companyId");
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClear}
      className="text-yellow-500 hover:text-yellow-400 hover:bg-accent"
    >
      <X className="w-4 h-4 mr-2" />
      Clear All
    </Button>
  );
}

// Filter Badge
export function UserFilterBadge({ label, value, param }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleRemove = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-yellow-600 dark:text-yellow-400 font-medium">
        {value}
      </span>
      <button
        onClick={handleRemove}
        className="ml-1 text-muted-foreground hover:text-yellow-600 dark:hover:text-yellow-400 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
