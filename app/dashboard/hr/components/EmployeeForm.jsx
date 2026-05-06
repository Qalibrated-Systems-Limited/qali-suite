"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createEmployee } from "@/app/mongodb/actions/hr-employee-actions";
import DepartmentCombobox from "./DepartmentCombobox";
import ManagerCombobox from "./ManagerCombobox";

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

export default function EmployeeForm({ departments = [], managers = [], defaults = null }) {
  const [state, formAction, isPending] = useActionState(createEmployee, initialState);
  const e = state.fieldErrors || {};
  const d = defaults || {};

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {d.linkedUserId && <input type="hidden" name="linkedUserId" value={d.linkedUserId} />}

      {/* Personal */}
      <SectionCard title="Personal Information">
        <div>
          <Label required>First Name</Label>
          <Input name="firstName" placeholder="John" defaultValue={d.firstName} error={e.firstName} />
        </div>
        <div>
          <Label required>Last Name</Label>
          <Input name="lastName" placeholder="Doe" defaultValue={d.lastName} error={e.lastName} />
        </div>
        <div>
          <Label>Date of Birth</Label>
          <Input name="dateOfBirth" type="date" />
        </div>
        <div>
          <Label>Gender</Label>
          <Select name="gender">
            <option value="">— Select —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label>National ID</Label>
          <Input name="nationalId" placeholder="12345678" />
        </div>
        <div>
          <Label>KRA PIN</Label>
          <Input name="kraPin" placeholder="A000000000X" />
        </div>
        <div>
          <Label>NSSF Number</Label>
          <Input name="nssfNumber" placeholder="NSSF number" />
        </div>
        <div>
          <Label>SHA Number</Label>
          <Input name="shaNumber" placeholder="SHA number" />
        </div>
      </SectionCard>

      {/* Contact */}
      <SectionCard title="Contact">
        <div>
          <Label>Email Address</Label>
          <Input name="email" type="email" placeholder="john.doe@company.com" defaultValue={d.email} />
          <p className="mt-1 text-xs text-muted-foreground">Required for portal login invite</p>
        </div>
        <div>
          <Label>Phone</Label>
          <Input name="phone" type="tel" placeholder="+254 7xx xxx xxx" />
        </div>
      </SectionCard>

      {/* Employment */}
      <SectionCard title="Employment">
        <div>
          <Label>Employee Number</Label>
          <Input name="employeeNumber" placeholder="Auto-generated if left blank" error={e.employeeNumber} />
          <p className="mt-1 text-xs text-muted-foreground">Leave blank to auto-generate (e.g. EMP0001)</p>
        </div>
        <div>
          <Label required>Hire Date</Label>
          <Input
            name="hireDate"
            type="date"
            error={e.hireDate}
            defaultValue={new Date().toISOString().split("T")[0]}
          />
        </div>
        <div>
          <Label>Employment Type</Label>
          <Select name="employmentType" defaultValue="full_time">
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
            <option value="casual">Casual</option>
          </Select>
        </div>
        <div>
          <Label>Department</Label>
          <DepartmentCombobox initialDepartments={departments} />
        </div>
        <div>
          <Label>Designation</Label>
          <Input name="designation" placeholder="e.g. Senior Accountant" />
        </div>
        <div>
          <Label>Job Grade</Label>
          <Input name="jobGrade" placeholder="e.g. G1, M2" />
        </div>
        <div>
          <Label>Work Location</Label>
          <Input name="workLocation" placeholder="e.g. Nairobi HQ" />
        </div>
        <div className="sm:col-span-2">
          <Label>Reporting Manager</Label>
          <ManagerCombobox managers={managers} error={e.managerId} />
        </div>
      </SectionCard>

      {/* Compensation */}
      <SectionCard title="Compensation">
        <div>
          <Label>Basic Salary (KES)</Label>
          <Input name="basicSalary" type="number" min="0" step="1" placeholder="0" />
        </div>
        <div>
          <Label>Housing Allowance (KES)</Label>
          <Input name="housingAllowance" type="number" min="0" step="1" placeholder="0" />
        </div>
        <div>
          <Label>Transport Allowance (KES)</Label>
          <Input name="transportAllowance" type="number" min="0" step="1" placeholder="0" />
        </div>
        <div>
          <Label>Payment Method</Label>
          <Select name="paymentMethod" defaultValue="bank">
            <option value="bank">Bank Transfer</option>
            <option value="mpesa">M-Pesa</option>
            <option value="cash">Cash</option>
          </Select>
        </div>
        <div>
          <Label>Bank Name</Label>
          <Input name="bankName" placeholder="e.g. KCB Bank" />
        </div>
        <div>
          <Label>Bank Account Number</Label>
          <Input name="bankAccount" placeholder="Account number" />
        </div>
        <div>
          <Label>M-Pesa Number</Label>
          <Input name="mpesaNumber" type="tel" placeholder="+254 7xx xxx xxx" />
        </div>
      </SectionCard>

      {/* Emergency Contact */}
      <SectionCard title="Emergency Contact" cols={3}>
        <div>
          <Label>Name</Label>
          <Input name="emergencyName" placeholder="Contact name" />
        </div>
        <div>
          <Label>Relationship</Label>
          <Input name="emergencyRelationship" placeholder="e.g. Spouse" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input name="emergencyPhone" type="tel" placeholder="+254 7xx xxx xxx" />
        </div>
      </SectionCard>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" asChild>
          <Link href="/dashboard/hr/employees">Cancel</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Saving..." : "Create Employee"}
        </Button>
      </div>

    </form>
  );
}
