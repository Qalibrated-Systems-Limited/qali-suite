"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateDepartment } from "@/app/mongodb/actions/hr-department-actions";

const initialState = { success: false, error: null, fieldErrors: null };

function FieldError({ error }) {
  if (!error) return null;
  return <p className="mt-1 text-xs text-destructive">{error}</p>;
}

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium text-foreground">
      {children}{required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

function Input({ name, defaultValue, placeholder, error, ...props }) {
  return (
    <>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "border-destructive" : "border-border"}`}
        {...props}
      />
      <FieldError error={error} />
    </>
  );
}

function EmployeePicker({ employees = [], defaultValue = null, onSelect }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filtered = search.trim()
    ? employees.filter((e) =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.employeeNumber?.toLowerCase().includes(search.toLowerCase())
      )
    : employees;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search by name or employee number..."
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {isOpen && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {filtered.slice(0, 20).map((emp) => (
            <button
              key={emp.partyId}
              type="button"
              onClick={() => {
                onSelect(emp);
                setSearch("");
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between"
            >
              <span className="font-medium text-foreground">{emp.name}</span>
              <span className="text-xs text-muted-foreground">{emp.employeeNumber}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen && search && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-lg p-3 text-sm text-muted-foreground text-center">
          No employees found
        </div>
      )}
    </div>
  );
}

export default function DepartmentEditForm({ department, employees = [] }) {
  const [state, formAction, isPending] = useActionState(updateDepartment, initialState);
  const fe = state.fieldErrors || {};

  const [head, setHead] = useState(
    department.head?.partyId
      ? { partyId: department.head.partyId, name: department.head.name || "", employeeNumber: department.head.employeeNumber || "" }
      : null
  );

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <input type="hidden" name="deptId" value={department._id} />
      <input type="hidden" name="headPartyId" value={head?.partyId || ""} />
      <input type="hidden" name="headName" value={head?.name || ""} />
      <input type="hidden" name="headEmployeeNumber" value={head?.employeeNumber || ""} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Basic info */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-foreground">Department Details</h2>
        <div>
          <Label required>Department Name</Label>
          <Input name="name" defaultValue={department.name} placeholder="e.g. Finance" error={fe.name} />
        </div>
        <div>
          <Label>Description</Label>
          <textarea
            name="description"
            rows={3}
            defaultValue={department.description || ""}
            placeholder="What this department does..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </section>

      {/* Department Head */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-foreground">Department Head</h2>
        <p className="text-xs text-muted-foreground -mt-2">Optional. Select an employee to lead this department.</p>

        {head ? (
          <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{head.name}</p>
              <p className="text-xs text-muted-foreground">{head.employeeNumber}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setHead(null)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <EmployeePicker
            employees={employees}
            onSelect={(emp) => setHead(emp)}
          />
        )}
      </section>

      <div className="flex justify-end gap-3">
        <Button variant="outline" asChild>
          <Link href={`/dashboard/hr/departments/${department._id}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
