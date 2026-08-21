"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateEmployee } from "@/app/db/actions/hr-employee-actions";
import DepartmentCombobox from "./DepartmentCombobox";
import ManagerCombobox from "./ManagerCombobox";

const initialState = { success: false, error: null, fieldErrors: null, values: null };

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

export default function EmployeeEditForm({ employee, departments = [], managers = [] }) {
  const [state, formAction, isPending] = useActionState(updateEmployee, initialState);
  const e = state.fieldErrors || {};
  // A rejected submit keeps what was typed, rather than reverting every field
  // to what is stored.
  const v = { ...employee, ...(state.values || {}) };

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="employeeId" value={employee.id} />

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
              <p className="mt-1 text-sm text-foreground">{employee.email || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This is the address they sign in with. Change it under Settings → Users.
              </p>
            </>
          ) : (
            <>
              <Input name="email" type="email" defaultValue={v.email} placeholder="john.doe@company.com" error={e.email} />
              <p className="mt-1 text-xs text-muted-foreground">Used for the portal invite</p>
            </>
          )}
        </div>
        <div>
          <Label>Phone</Label>
          <Input name="phone" type="tel" defaultValue={v.phone} placeholder="+254 7xx xxx xxx" error={e.phone} />
        </div>
      </SectionCard>

      {/* Personal */}
      <SectionCard title="Personal Information">
        <div>
          <Label required>First Name</Label>
          <Input name="firstName" defaultValue={v.firstName} placeholder="John" error={e.firstName} />
        </div>
        <div>
          <Label required>Last Name</Label>
          <Input name="lastName" defaultValue={v.lastName} placeholder="Doe" error={e.lastName} />
        </div>
        <div>
          <Label>Date of Birth</Label>
          <Input
            name="dateOfBirth"
            type="date"
            defaultValue={v.dateOfBirth || ""}
          />
        </div>
        <div>
          <Label>Gender</Label>
          <Select name="gender" defaultValue={v.gender || ""}>
            <option value="">— Select —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label>National ID</Label>
          <Input name="nationalId" defaultValue={v.nationalId} placeholder="12345678" />
        </div>
        <div>
          <Label>KRA PIN</Label>
          <Input name="kraPin" defaultValue={v.kraPin} placeholder="A000000000X" />
        </div>
        <div>
          <Label>NSSF Number</Label>
          <Input name="nssfNumber" defaultValue={v.nssfNumber} placeholder="NSSF number" />
        </div>
        <div>
          <Label>SHA Number</Label>
          <Input name="shaNumber" defaultValue={v.shaNumber} placeholder="SHA number" />
        </div>
      </SectionCard>

      {/* Employment (non-financial) */}
      <SectionCard title="Employment">
        <div>
          <Label>Employee Number</Label>
          <Input name="employeeNumber" defaultValue={v.employeeNumber} placeholder="e.g. EMP-00001" error={e.employeeNumber} />
        </div>
        <div>
          <Label>Department</Label>
          <DepartmentCombobox
            initialDepartments={departments}
            defaultValue={employee.departmentId ? { id: employee.departmentId, name: employee.department || "" } : null}
          />
        </div>
        <div>
          <Label>Designation</Label>
          <Input name="designation" defaultValue={v.designation} placeholder="e.g. Senior Accountant" />
        </div>
        {/* Employment type and the reporting line could be set when somebody
            was hired and never changed afterwards — the form simply did not
            carry them, so a promotion into management could not be recorded. */}
        <div>
          <Label>Employment Type</Label>
          <Select name="employmentType" defaultValue={v.employmentType || "full_time"}>
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
            <option value="casual">Casual</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Reporting Manager</Label>
          <ManagerCombobox
            managers={managers}
            defaultValue={
              employee.managerId
                ? { id: employee.managerId, name: employee.managerName || "" }
                : null
            }
          />
        </div>
        <div>
          <Label>Job Grade</Label>
          <Input name="jobGrade" defaultValue={v.jobGrade} placeholder="e.g. G1, M2" />
        </div>
        <div>
          <Label>Work Location</Label>
          <Input name="workLocation" defaultValue={v.workLocation} placeholder="e.g. Nairobi HQ" />
        </div>
        <div>
          <Label>Shift Start <span className="text-muted-foreground text-xs font-normal">(leave blank to use company default)</span></Label>
          <Input name="shiftStart" type="time" defaultValue={v.shiftStart || ""} />
        </div>
        <div>
          <Label>Shift End <span className="text-muted-foreground text-xs font-normal">(leave blank to use company default)</span></Label>
          <Input name="shiftEnd" type="time" defaultValue={v.shiftEnd || ""} />
        </div>
        <div>
          <Label>Contract End Date <span className="text-muted-foreground text-xs">(for contract/casual staff)</span></Label>
          <Input
            name="contractEnd"
            type="date"
            defaultValue={v.contractEnd || ""}
          />
        </div>
        <div>
          <Label>Contract Type</Label>
          <select name="contractType" defaultValue={v.contractType || ""} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
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
          <Input name="emergencyName" defaultValue={v.emergencyName} placeholder="Contact name" />
        </div>
        <div>
          <Label>Relationship</Label>
          <Input name="emergencyRelationship" defaultValue={v.emergencyRelationship} placeholder="e.g. Spouse" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input name="emergencyPhone" type="tel" defaultValue={v.emergencyPhone} placeholder="+254 7xx xxx xxx" />
        </div>
      </SectionCard>

      {/* Notes */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-foreground">Notes</h2>
        <textarea
          name="notes"
          rows={3}
          defaultValue={v.notes || ""}
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
