"use client";

import { useActionState, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle, ChevronsUpDown, Check } from "lucide-react";
import { createLoanRequest } from "@/app/mongodb/actions/loan-actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const LOAN_TYPES = [
  { value: "salary_advance", label: "Salary Advance", description: "Short-term advance against salary (1-3 months, no interest)" },
  { value: "staff_loan", label: "Staff Loan", description: "Longer-term loan with optional interest (up to 60 months)" },
  { value: "sacco_deduction", label: "SACCO Deduction", description: "Recurring SACCO contribution deducted from payroll" },
];

const INTEREST_TYPES = [
  { value: "none", label: "No Interest" },
  { value: "flat", label: "Flat Rate" },
  { value: "reducing_balance", label: "Reducing Balance (EMI)" },
];

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const initialState = { success: false, error: null, fieldErrors: null, loanId: null };

function EmployeeCombobox({ employees, value, onChange, hasError }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = employees.find((e) => e.partyId === value) || null;
  const filtered = search
    ? employees.filter((e) =>
        `${e.name} ${e.employeeNumber} ${e.department}`.toLowerCase().includes(search.toLowerCase())
      )
    : employees;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={`w-full flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${hasError ? "border-destructive" : "border-border"}`}
        >
          {selected ? (
            <span>
              {selected.name}
              {selected.employeeNumber && <span className="ml-2 text-muted-foreground">({selected.employeeNumber})</span>}
              {selected.department && <span className="ml-2 text-muted-foreground">- {selected.department}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">Choose an employee...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name, number, or department..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((emp) => (
                <CommandItem
                  key={emp.partyId}
                  value={emp.partyId}
                  onSelect={() => {
                    onChange(emp);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 shrink-0 ${value === emp.partyId ? "opacity-100" : "opacity-0"}`} />
                  <div className="min-w-0">
                    <span className="font-medium">{emp.name}</span>
                    {emp.employeeNumber && <span className="ml-2 text-xs text-muted-foreground">{emp.employeeNumber}</span>}
                    {emp.department && <span className="ml-2 text-xs text-muted-foreground">- {emp.department}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function computeSchedulePreview(principalAmount, tenure, interestRate, interestType) {
  if (!principalAmount || !tenure || principalAmount <= 0 || tenure < 1) return [];

  const schedule = [];
  let remaining = principalAmount;

  if (interestType === "none" || interestRate === 0) {
    const monthlyP = Math.floor(principalAmount / tenure);
    const lastP = principalAmount - monthlyP * (tenure - 1);
    for (let i = 0; i < tenure; i++) {
      const p = i === tenure - 1 ? lastP : monthlyP;
      schedule.push({ principal: p, interest: 0, total: p });
    }
  } else if (interestType === "flat") {
    const totalInterest = principalAmount * (interestRate / 100) * (tenure / 12);
    const monthlyP = Math.floor(principalAmount / tenure);
    const monthlyI = Math.floor(totalInterest / tenure);
    const lastP = principalAmount - monthlyP * (tenure - 1);
    const lastI = Math.round(totalInterest) - monthlyI * (tenure - 1);
    for (let i = 0; i < tenure; i++) {
      const p = i === tenure - 1 ? lastP : monthlyP;
      const int = i === tenure - 1 ? lastI : monthlyI;
      schedule.push({ principal: p, interest: int, total: p + int });
    }
  } else if (interestType === "reducing_balance") {
    const monthlyRate = interestRate / 100 / 12;
    const n = tenure;
    const emi = Math.round(
      (principalAmount * monthlyRate * Math.pow(1 + monthlyRate, n)) /
      (Math.pow(1 + monthlyRate, n) - 1)
    );
    for (let i = 0; i < n; i++) {
      const interest = Math.round(remaining * monthlyRate);
      let principal = emi - interest;
      if (i === n - 1) principal = remaining;
      const total = principal + interest;
      schedule.push({ principal, interest, total });
      remaining -= principal;
    }
  }

  return schedule;
}

export default function LoanRequestForm({ employees = [], selfProfile = null, isAdmin = false }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createLoanRequest, initialState);

  const [selectedPartyId, setSelectedPartyId] = useState(selfProfile?.partyId || "");
  const [loanType, setLoanType] = useState("salary_advance");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [tenure, setTenure] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [interestType, setInterestType] = useState("none");

  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2];

  // Redirect on success
  if (state.success && state.loanId) {
    router.push(`/dashboard/hr/loans/${state.loanId}`);
  }

  // Compute live preview
  const preview = useMemo(() => {
    const amount = parseFloat(principalAmount) || 0;
    const months = parseInt(tenure) || 0;
    const rate = loanType === "staff_loan" ? (parseFloat(interestRate) || 0) : 0;
    const type = loanType === "staff_loan" ? interestType : "none";
    return computeSchedulePreview(amount, months, rate, type);
  }, [principalAmount, tenure, interestRate, interestType, loanType]);

  const totalRepayable = preview.reduce((s, r) => s + r.total, 0);
  const totalInterest = preview.reduce((s, r) => s + r.interest, 0);

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden partyId field for form submission */}
      <input type="hidden" name="partyId" value={selectedPartyId} />
      <input type="hidden" name="interestRate" value={loanType === "staff_loan" ? (parseFloat(interestRate) / 100 || 0) : 0} />
      <input type="hidden" name="interestType" value={loanType === "staff_loan" ? interestType : "none"} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Employee Selection */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Employee</h2>
        {isAdmin ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Select Employee <span className="text-destructive">*</span>
            </label>
            <EmployeeCombobox
              employees={employees}
              value={selectedPartyId}
              onChange={(emp) => setSelectedPartyId(emp.partyId)}
              hasError={!!state.fieldErrors?.partyId}
            />
            {state.fieldErrors?.partyId && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.partyId}</p>
            )}
          </div>
        ) : selfProfile ? (
          <div className="rounded-md bg-muted/50 p-3">
            <p className="font-medium text-foreground">{selfProfile.name}</p>
            <p className="text-xs text-muted-foreground">
              {selfProfile.employeeNumber} {selfProfile.department && `- ${selfProfile.department}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No employee profile found.</p>
        )}
      </div>

      {/* Loan Type */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Loan Type</h2>
        <div className="grid gap-3">
          {LOAN_TYPES.map((lt) => (
            <label
              key={lt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                loanType === lt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="loanType"
                value={lt.value}
                checked={loanType === lt.value}
                onChange={() => {
                  setLoanType(lt.value);
                  if (lt.value === "salary_advance") {
                    setInterestRate("");
                    setInterestType("none");
                    if (!tenure || parseInt(tenure) > 3) setTenure("1");
                  }
                  if (lt.value === "sacco_deduction") {
                    setInterestRate("");
                    setInterestType("none");
                  }
                }}
                className="mt-1 accent-primary"
              />
              <div>
                <p className="font-medium text-foreground">{lt.label}</p>
                <p className="text-xs text-muted-foreground">{lt.description}</p>
              </div>
            </label>
          ))}
        </div>
        {state.fieldErrors?.loanType && (
          <p className="text-xs text-destructive">{state.fieldErrors.loanType}</p>
        )}
      </div>

      {/* Loan Terms */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Loan Terms</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Principal Amount (KES) <span className="text-destructive">*</span>
            </label>
            <input
              type="number"
              name="principalAmount"
              value={principalAmount}
              onChange={(e) => setPrincipalAmount(e.target.value)}
              min="1"
              step="1"
              placeholder="e.g. 50000"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.principalAmount ? "border-destructive" : "border-border"}`}
            />
            {state.fieldErrors?.principalAmount && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.principalAmount}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Tenure (months) <span className="text-destructive">*</span>
            </label>
            <input
              type="number"
              name="tenure"
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
              min="1"
              max={loanType === "salary_advance" ? 3 : 120}
              placeholder={loanType === "salary_advance" ? "1-3" : loanType === "sacco_deduction" ? "e.g. 12" : "1-60"}
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.tenure ? "border-destructive" : "border-border"}`}
            />
            {state.fieldErrors?.tenure && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.tenure}</p>
            )}
          </div>
        </div>

        {/* Interest fields - only for staff_loan */}
        {loanType === "staff_loan" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Interest Rate (% per annum)
              </label>
              <input
                type="number"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                min="0"
                max="100"
                step="0.1"
                placeholder="e.g. 12"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">Leave 0 for interest-free loan</p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Interest Type
              </label>
              <select
                value={interestType}
                onChange={(e) => setInterestType(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {INTEREST_TYPES.map((it) => (
                  <option key={it.value} value={it.value}>{it.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Start Month/Year */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Start Month <span className="text-destructive">*</span>
            </label>
            <select
              name="startMonth"
              defaultValue={now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2}
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.startMonth ? "border-destructive" : "border-border"}`}
            >
              {MONTH_NAMES.slice(1).map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
            {state.fieldErrors?.startMonth && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.startMonth}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Start Year <span className="text-destructive">*</span>
            </label>
            <select
              name="startYear"
              defaultValue={now.getMonth() + 2 > 12 ? currentYear + 1 : currentYear}
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.startYear ? "border-destructive" : "border-border"}`}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {state.fieldErrors?.startYear && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.startYear}</p>
            )}
          </div>
        </div>
      </div>

      {/* Purpose & Notes */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Purpose</label>
          <textarea
            name="purpose"
            rows={2}
            placeholder="Why is this loan needed?"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Notes (optional)</label>
          <textarea
            name="notes"
            rows={2}
            placeholder="Any additional notes..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Installment Preview */}
      {preview.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Installment Preview</h2>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Payment</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                KES {(preview[0]?.total || 0).toLocaleString("en-KE")}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Interest</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                KES {totalInterest.toLocaleString("en-KE")}
              </p>
            </div>
            <div className="rounded-lg bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Repayable</p>
              <p className="mt-1 text-lg font-bold text-primary">
                KES {totalRepayable.toLocaleString("en-KE")}
              </p>
            </div>
          </div>

          {preview.length <= 12 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2 text-right">Principal</th>
                    <th className="px-3 py-2 text-right">Interest</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2 text-right">{row.principal.toLocaleString("en-KE")}</td>
                      <td className="px-3 py-2 text-right">{row.interest.toLocaleString("en-KE")}</td>
                      <td className="px-3 py-2 text-right font-medium">{row.total.toLocaleString("en-KE")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.length > 12 && (
            <p className="text-xs text-muted-foreground text-center">
              Showing summary for {preview.length} installments. Full schedule will be available on the loan detail page.
            </p>
          )}
        </div>
      )}

      {/* Info note */}
      <div className="rounded-lg border border-blue-200 bg-blue-500/5 p-4 text-sm text-blue-700 dark:border-blue-900 dark:text-blue-400">
        After submitting, the loan request will go through the approval workflow. Once approved and disbursed, installments will be automatically deducted during payroll processing.
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Link
          href="/dashboard/hr/loans"
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Submitting..." : "Submit Loan Request"}
        </button>
      </div>
    </form>
  );
}
