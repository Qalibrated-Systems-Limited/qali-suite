"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle, Info, ChevronsUpDown, Check } from "lucide-react";
import { createLeaveRequest } from "@/app/mongodb/actions/hr-leave-actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const LEAVE_TYPES = [
  { value: "annual", label: "Annual Leave" },
  { value: "sick", label: "Sick Leave" },
  { value: "maternity", label: "Maternity Leave" },
  { value: "paternity", label: "Paternity Leave" },
  { value: "compassionate", label: "Compassionate Leave" },
  { value: "study", label: "Study Leave" },
  { value: "unpaid", label: "Unpaid Leave" },
];

const initialState = { success: false, error: null, fieldErrors: null };

function EmployeeCombobox({ employees, value, onChange, hasError }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = employees.find((e) => e._id === value) || null;
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
              {selected.department && <span className="ml-2 text-muted-foreground">· {selected.department}</span>}
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
                  key={emp._id}
                  value={emp._id}
                  onSelect={() => {
                    onChange(emp);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 shrink-0 ${value === emp._id ? "opacity-100" : "opacity-0"}`} />
                  <div className="min-w-0">
                    <span className="font-medium">{emp.name}</span>
                    {emp.employeeNumber && <span className="ml-2 text-xs text-muted-foreground">{emp.employeeNumber}</span>}
                    {emp.department && <span className="ml-2 text-xs text-muted-foreground">· {emp.department}</span>}
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

function calcWorkingDays(fromStr, toStr, halfDay = false) {
  if (!fromStr || !toStr) return 0;
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (to < from) return 0;
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  if (halfDay && count > 0) return 0.5;
  return count;
}

export default function LeaveRequestForm({ employees, selfProfile, isApprover }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createLeaveRequest, initialState);

  const [selectedEmployee, setSelectedEmployee] = useState(selfProfile || null);
  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);

  useEffect(() => {
    if (state.success && state.leaveId) {
      router.push(`/dashboard/hr/leave/${state.leaveId}`);
    }
  }, [state.success, state.leaveId, router]);

  const currentBalance = selectedEmployee?.leaveBalances?.find((b) => b.leaveType === leaveType);
  const availableBalance = currentBalance
    ? (currentBalance.balanceDays || 0) - (currentBalance.pendingDays || 0)
    : null;
  const requestedDays = calcWorkingDays(fromDate, toDate, halfDay);
  const today = new Date().toISOString().split("T")[0];

  function handleEmployeeSelect(emp) {
    setSelectedEmployee(emp);
    setLeaveType("");
  }

  const inputClass = (hasError) =>
    `w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${hasError ? "border-destructive" : "border-border"}`;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="profileId" value={selectedEmployee?._id || ""} />
      <input type="hidden" name="partyId" value={selectedEmployee?.partyId || ""} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Employee selection (approver) */}
      {isApprover && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-sm text-foreground">Employee</h2>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Select Employee <span className="text-destructive">*</span>
            </label>
            <EmployeeCombobox
              employees={employees}
              value={selectedEmployee?._id || ""}
              onChange={handleEmployeeSelect}
              hasError={!!state.fieldErrors?.profileId}
            />
            {state.fieldErrors?.profileId && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.profileId}</p>
            )}
          </div>
        </div>
      )}

      {/* Self profile display */}
      {!isApprover && selfProfile && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Submitting for</p>
          <p className="font-semibold text-foreground">{selfProfile.name}</p>
          <p className="text-xs text-muted-foreground">{selfProfile.employeeNumber} · {selfProfile.department}</p>
        </div>
      )}

      {!isApprover && !selfProfile && (
        <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-4 text-sm text-amber-700 dark:border-amber-900 dark:text-amber-400">
          Your employee profile is not linked to this account. Contact HR to set up your profile.
        </div>
      )}

      {/* Leave details */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-sm text-foreground">Leave Details</h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Leave Type <span className="text-destructive">*</span>
          </label>
          <select
            name="leaveType"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value)}
            className={inputClass(!!state.fieldErrors?.leaveType)}
          >
            <option value="" disabled>Select leave type...</option>
            {LEAVE_TYPES.map((lt) => (
              <option key={lt.value} value={lt.value}>{lt.label}</option>
            ))}
          </select>
          {state.fieldErrors?.leaveType && (
            <p className="mt-1 text-xs text-destructive">{state.fieldErrors.leaveType}</p>
          )}

          {leaveType && selectedEmployee && leaveType !== "unpaid" && (
            <div className={`mt-2 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs ${
              currentBalance
                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}>
              <Info className="h-3 w-3 shrink-0" />
              {currentBalance ? (
                <>Balance: <strong>{availableBalance} days available</strong> ({currentBalance.usedDays} used of {currentBalance.entitledDays} entitled)</>
              ) : (
                "No leave balance configured for this type"
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              From <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              name="fromDate"
              value={fromDate}
              min={today}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputClass(!!state.fieldErrors?.fromDate)}
            />
            {state.fieldErrors?.fromDate && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.fromDate}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              To <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              name="toDate"
              value={toDate}
              min={fromDate || today}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass(!!state.fieldErrors?.toDate)}
            />
            {state.fieldErrors?.toDate && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.toDate}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="halfDay"
            name="halfDay"
            value="true"
            checked={halfDay}
            onChange={(e) => setHalfDay(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="halfDay" className="text-sm text-foreground">Half day</label>
          {halfDay && (
            <select name="halfDayPeriod" className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
            </select>
          )}
        </div>

        {fromDate && toDate && (
          <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            requestedDays === 0
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground"
          }`}>
            {requestedDays === 0
              ? "Selected range has no working days"
              : <><strong className="text-foreground">{requestedDays} working {requestedDays === 1 ? "day" : "days"}</strong> requested <span className="text-xs opacity-70">(excl. public holidays on submit)</span></>
            }
          </div>
        )}
      </div>

      {/* Reason */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-sm text-foreground">Reason</h2>
        <textarea
          name="reason"
          rows={3}
          placeholder="Brief reason for the leave request (optional for annual leave)..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <Link href="/dashboard/hr/leave" className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground">
          Cancel
        </Link>
        <button
          type="submit"
          name="submitNow"
          value="false"
          disabled={isPending || !selectedEmployee}
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
        >
          Save Draft
        </button>
        <button
          type="submit"
          name="submitNow"
          value="true"
          disabled={isPending || !selectedEmployee}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Submitting..." : "Submit for Approval"}
        </button>
      </div>
    </form>
  );
}
