"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateCompensation } from "@/app/db/actions/hr-employee-actions";

const initialState = { success: false, error: null, fieldErrors: null };

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium text-foreground">
      {children}{required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

function Input({ name, defaultValue, placeholder, error, type = "text", ...props }) {
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
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}

/** Today, on the LOCAL calendar. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const money = (n) => `KES ${(n || 0).toLocaleString("en-KE")}`;

export default function CompensationEditForm({ employee, history = [] }) {
  const [state, formAction, isPending] = useActionState(updateCompensation, initialState);
  const fe = state.fieldErrors || {};

  const [method, setMethod] = useState(employee.paymentMethod || "bank");

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <input type="hidden" name="employeeId" value={employee.id} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Compensation updated successfully.
        </div>
      )}

      {/* Salary */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-foreground">Salary</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label required>Basic Salary (KES)</Label>
            <Input
              name="basicSalary"
              type="number"
              min="0"
              step="1"
              defaultValue={employee.basicSalary || 0}
              placeholder="0"
              error={fe.basicSalary}
            />
          </div>
          <div>
            <Label>Housing Allowance (KES)</Label>
            <Input name="housingAllowance" type="number" min="0" step="1" defaultValue={employee.allowanceHousing || 0} placeholder="0" />
          </div>
          <div>
            <Label>Transport Allowance (KES)</Label>
            <Input name="transportAllowance" type="number" min="0" step="1" defaultValue={employee.allowanceTransport || 0} placeholder="0" />
          </div>
          <div>
            <Label>Medical Allowance (KES)</Label>
            <Input name="medicalAllowance" type="number" min="0" step="1" defaultValue={employee.allowanceMedical || 0} placeholder="0" />
          </div>
          <div>
            <Label>Other Allowance (KES)</Label>
            <Input name="otherAllowance" type="number" min="0" step="1" defaultValue={employee.allowanceOther || 0} placeholder="0" />
          </div>
        </div>
      </section>

      {/* Payment Method */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-foreground">Payment Details</h2>
        <div>
          <Label>Payment Method</Label>
          <select
            name="paymentMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="bank">Bank Transfer</option>
            <option value="mpesa">M-Pesa</option>
            <option value="cash">Cash</option>
          </select>
        </div>

        {method === "bank" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Bank Name</Label>
              <Input name="bankName" defaultValue={employee.bankName || ""} placeholder="e.g. Equity Bank" />
            </div>
            <div>
              <Label>Branch</Label>
              <Input name="bankBranch" defaultValue={employee.bankBranch || ""} placeholder="e.g. Westlands" />
            </div>
            <div className="sm:col-span-2">
              <Label>Account Number</Label>
              <Input name="bankAccount" defaultValue={employee.bankAccount || ""} placeholder="Account number" />
            </div>
          </div>
        )}

        {method === "mpesa" && (
          <div>
            <Label>M-Pesa Number</Label>
            <Input name="mpesaNumber" type="tel" defaultValue={employee.mpesaNumber || ""} placeholder="+254 7xx xxx xxx" />
          </div>
        )}
      </section>

      {/* The salary-change record has always carried an effective date and a
          reason, and the form offered neither — so every raise was dated the
          day somebody happened to open this page, with nothing said about why. */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold text-foreground">Why, and from when</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Effective from</Label>
            <Input name="effectiveDate" type="date" defaultValue={today()} />
          </div>
          <div>
            <Label>Reason</Label>
            <Input name="reason" placeholder="e.g. Annual review, promotion" />
          </div>
        </div>
      </section>

      {history.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-foreground">Previous changes</h2>
          <ul className="divide-y divide-border text-sm">
            {history.slice(0, 8).map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-foreground">
                  {money(h.previousGross)} → {money(h.newGross)}
                  <span
                    className={`ml-2 text-xs ${h.grossChange >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
                  >
                    {h.grossChange >= 0 ? "+" : ""}
                    {h.grossChange.toLocaleString("en-KE")}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(`${h.effectiveDate}T00:00:00`).toLocaleDateString("en-KE")}
                  {h.reason ? ` · ${h.reason}` : ""}
                  {h.changedByName ? ` · ${h.changedByName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="outline" asChild>
          <Link href={`/dashboard/hr/employees/${employee.id}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Saving..." : "Save Compensation"}
        </Button>
      </div>
    </form>
  );
}
