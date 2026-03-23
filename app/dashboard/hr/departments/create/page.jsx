"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { createDepartment } from "@/app/mongodb/actions/hr-department-actions";

const initialState = { success: false, error: null, fieldErrors: null };

export default function CreateDepartmentPage() {
  const [state, formAction, isPending] = useActionState(createDepartment, initialState);

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/departments" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Departments
        </Link>
        <span>/</span>
        <span className="text-foreground">New Department</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Add Department</h1>
        <p className="text-muted-foreground">Department code is auto-generated</p>
      </div>

      <form action={formAction} className="space-y-6">
        {state.error && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Department Name <span className="text-destructive">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="e.g. Finance, Operations"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.name ? "border-destructive" : "border-border"}`}
            />
            {state.fieldErrors?.name && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.name}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Description</label>
            <textarea
              name="description"
              rows={3}
              placeholder="What this department does..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/hr/departments" className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Creating..." : "Create Department"}
          </button>
        </div>
      </form>
    </div>
  );
}
