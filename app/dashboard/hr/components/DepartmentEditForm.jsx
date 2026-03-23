"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
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

export default function DepartmentEditForm({ department }) {
  const [state, formAction, isPending] = useActionState(updateDepartment, initialState);
  const fe = state.fieldErrors || {};

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <input type="hidden" name="deptId" value={department._id} />

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
        <p className="text-xs text-muted-foreground -mt-2">Optional. Paste the employee&apos;s Party ID or leave blank.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Head Name</Label>
            <Input name="headName" defaultValue={department.head?.name || ""} placeholder="Full name" />
          </div>
          <div>
            <Label>Employee Number</Label>
            <Input name="headEmployeeNumber" defaultValue={department.head?.employeeNumber || ""} placeholder="EMP0001" />
          </div>
        </div>
        <div>
          <Label>Party ID</Label>
          <Input name="headPartyId" defaultValue={department.head?.partyId || ""} placeholder="MongoDB ObjectId of the Party" />
        </div>
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
