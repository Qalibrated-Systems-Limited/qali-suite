"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateEmployee } from "@/app/mongodb/actions/hr-employee-actions";
import DepartmentCombobox from "./DepartmentCombobox";

const initialState = { success: false, error: null, fieldErrors: null };

function FieldError({ error }) {
  if (!error) return null;
  return <p className="mt-1 text-xs text-destructive">{error}</p>;
}

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium text-foreground">
      {children}
      {required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

function Input({ name, type = "text", defaultValue, placeholder, error, ...props }) {
  return (
    <>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "border-destructive" : "border-border"}`}
        {...props}
      />
      <FieldError error={error} />
    </>
  );
}

function Select({ name, defaultValue, children, error }) {
  return (
    <>
      <select
        name={name}
        defaultValue={defaultValue}
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "border-destructive" : "border-border"}`}
      >
        {children}
      </select>
      <FieldError error={error} />
    </>
  );
}

function SectionCard({ title, children, cols = 2 }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-4 font-semibold text-foreground">{title}</h2>
      <div className={`grid gap-4 sm:grid-cols-${cols}`}>{children}</div>
    </section>
  );
}

export default function EmployeeEditForm({ employee, departments = [] }) {
  const [state, formAction, isPending] = useActionState(updateEmployee, initialState);
  const e = state.fieldErrors || {};

  const p = employee.personalInfo || {};
  const emp = employee.employment || {};
  const ec = employee.emergencyContact || {};

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="profileId" value={employee._id} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Contact */}
      <SectionCard title="Contact Information">
        <div>
          <Label>Email Address</Label>
          {employee.userId ? (
            <>
              <input type="hidden" name="email" value={employee.contactEmail || ""} />
              <p className="mt-1 text-sm text-foreground">{employee.contactEmail || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Email cannot be changed — employee has an active portal login.</p>
            </>
          ) : (
            <>
              <Input name="email" type="email" defaultValue={employee.contactEmail} placeholder="john.doe@company.com" error={e.email} />
              <p className="mt-1 text-xs text-muted-foreground">Used for portal invite</p>
            </>
          )}
        </div>
        <div>
          <Label>Phone</Label>
          <Input name="phone" type="tel" defaultValue={employee.contactPhone} placeholder="+254 7xx xxx xxx" error={e.phone} />
        </div>
      </SectionCard>

      {/* Personal */}
      <SectionCard title="Personal Information">
        <div>
          <Label required>First Name</Label>
          <Input name="firstName" defaultValue={p.firstName} placeholder="John" error={e.firstName} />
        </div>
        <div>
          <Label required>Last Name</Label>
          <Input name="lastName" defaultValue={p.lastName} placeholder="Doe" error={e.lastName} />
        </div>
        <div>
          <Label>Date of Birth</Label>
          <Input
            name="dateOfBirth"
            type="date"
            defaultValue={p.dateOfBirth ? new Date(p.dateOfBirth).toISOString().split("T")[0] : ""}
          />
        </div>
        <div>
          <Label>Gender</Label>
          <Select name="gender" defaultValue={p.gender || ""}>
            <option value="">— Select —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label>National ID</Label>
          <Input name="nationalId" defaultValue={p.nationalId} placeholder="12345678" />
        </div>
        <div>
          <Label>KRA PIN</Label>
          <Input name="kraPin" defaultValue={p.kraPin} placeholder="A000000000X" />
        </div>
        <div>
          <Label>NSSF Number</Label>
          <Input name="nssfNumber" defaultValue={p.nssfNumber} placeholder="NSSF number" />
        </div>
        <div>
          <Label>SHA Number</Label>
          <Input name="shaNumber" defaultValue={p.shaNumber} placeholder="SHA number" />
        </div>
      </SectionCard>

      {/* Employment (non-financial) */}
      <SectionCard title="Employment">
        <div>
          <Label>Employee Number</Label>
          <Input name="employeeNumber" defaultValue={employee.employeeNumber} placeholder="e.g. EMP0001" error={e.employeeNumber} />
        </div>
        <div>
          <Label>Department</Label>
          <DepartmentCombobox
            initialDepartments={departments}
            defaultValue={emp.departmentId ? { _id: emp.departmentId.toString(), name: emp.department || "" } : null}
          />
        </div>
        <div>
          <Label>Designation</Label>
          <Input name="designation" defaultValue={emp.designation} placeholder="e.g. Senior Accountant" />
        </div>
        <div>
          <Label>Job Grade</Label>
          <Input name="jobGrade" defaultValue={emp.jobGrade} placeholder="e.g. G1, M2" />
        </div>
        <div>
          <Label>Work Location</Label>
          <Input name="workLocation" defaultValue={emp.workLocation} placeholder="e.g. Nairobi HQ" />
        </div>
        <div>
          <Label>Shift Start <span className="text-muted-foreground text-xs font-normal">(leave blank to use company default)</span></Label>
          <Input name="shiftStart" type="time" defaultValue={emp.shiftStart || ""} />
        </div>
        <div>
          <Label>Shift End <span className="text-muted-foreground text-xs font-normal">(leave blank to use company default)</span></Label>
          <Input name="shiftEnd" type="time" defaultValue={emp.shiftEnd || ""} />
        </div>
        <div>
          <Label>Contract End Date <span className="text-muted-foreground text-xs">(for contract/casual staff)</span></Label>
          <Input
            name="contractEnd"
            type="date"
            defaultValue={emp.contractEnd ? new Date(emp.contractEnd).toISOString().split("T")[0] : ""}
          />
        </div>
        <div>
          <Label>Contract Type</Label>
          <select name="contractType" defaultValue={emp.contractType || ""} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">—</option>
            <option value="fixed_term">Fixed Term</option>
            <option value="renewable">Renewable</option>
            <option value="project_based">Project Based</option>
          </select>
        </div>
      </SectionCard>

      {/* Emergency Contact */}
      <SectionCard title="Emergency Contact" cols={3}>
        <div>
          <Label>Name</Label>
          <Input name="emergencyName" defaultValue={ec.name} placeholder="Contact name" />
        </div>
        <div>
          <Label>Relationship</Label>
          <Input name="emergencyRelationship" defaultValue={ec.relationship} placeholder="e.g. Spouse" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input name="emergencyPhone" type="tel" defaultValue={ec.phone} placeholder="+254 7xx xxx xxx" />
        </div>
      </SectionCard>

      {/* Notes */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-foreground">Notes</h2>
        <textarea
          name="notes"
          rows={3}
          defaultValue={employee.notes || ""}
          placeholder="Internal notes about this employee..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </section>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" asChild>
          <Link href={`/dashboard/hr/employees/${employee._id}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

    </form>
  );
}
