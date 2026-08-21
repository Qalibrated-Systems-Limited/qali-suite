"use client";

import { useActionState, useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, Info, ChevronsUpDown, Check } from "lucide-react";
import { createLeaveRequest, getEmployeeLeaveBalances } from "@/app/db/actions/hr-leave-actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

const initialState = { success: false, error: null, fieldErrors: null };

/** Today, on the LOCAL calendar. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputClass = (hasError) =>
  `w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
    hasError ? "border-destructive" : "border-border"
  }`;

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium text-foreground">
      {children}
      {required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

function EmployeePicker({ employees, selected, onSelect, hasError }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between bg-background font-normal",
            !selected && "text-muted-foreground",
            hasError && "border-destructive",
          )}
        >
          {selected ? selected.name : "Choose an employee…"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name or number…" />
          <CommandList>
            <CommandEmpty>Nobody found.</CommandEmpty>
            <CommandGroup>
              {employees.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`${e.name} ${e.employeeNumber}`}
                  onSelect={() => {
                    onSelect(e);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected?.id === e.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1">{e.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {e.employeeNumber}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Raise a leave request.
 *
 * The balance shown is the LIVE one — entitled plus brought forward, less
 * taken, encashed and anything still awaiting a decision — so the number the
 * person sees is the number the server will check against.
 */
export default function LeaveRequestForm({
  leaveTypes = [],
  employees = [],
  balances: initialBalances = [],
  me,
  isApprover,
}) {
  const [state, formAction, isPending] = useActionState(createLeaveRequest, initialState);

  const [employee, setEmployee] = useState(
    isApprover ? null : me ? { id: me.id, name: me.name } : null,
  );
  const [balances, setBalances] = useState(initialBalances);
  const [loadingBalances, startLoading] = useTransition();

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);

  // An approver picking somebody else needs THEIR balance, not the page's.
  useEffect(() => {
    if (!isApprover || !employee?.id) return;
    startLoading(async () => {
      const result = await getEmployeeLeaveBalances(employee.id);
      setBalances(result?.balances ?? []);
    });
  }, [isApprover, employee?.id]);

  const type = leaveTypes.find((t) => t.id === leaveTypeId);
  const balance = balances.find((b) => b.leaveTypeId === leaveTypeId);

  if (!isApprover && !me) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-8 text-center dark:border-amber-900">
        <p className="font-medium text-amber-700 dark:text-amber-400">
          You do not have an employee record yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask HR to create one — leave, payslips and attendance all hang off it.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <input type="hidden" name="employeeId" value={employee?.id || ""} />

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        {isApprover && (
          <div>
            <Label required>Employee</Label>
            <EmployeePicker
              employees={employees}
              selected={employee}
              onSelect={setEmployee}
              hasError={!!state.fieldErrors?.employeeId}
            />
            {state.fieldErrors?.employeeId && (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.employeeId}
              </p>
            )}
          </div>
        )}

        <div>
          <Label required>Leave type</Label>
          <select
            name="leaveTypeId"
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            className={inputClass(!!state.fieldErrors?.leaveTypeId)}
          >
            <option value="">— Choose —</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isPaid ? "" : " (unpaid)"}
              </option>
            ))}
          </select>
          {state.fieldErrors?.leaveTypeId && (
            <p className="mt-1 text-xs text-destructive">{state.fieldErrors.leaveTypeId}</p>
          )}

          {type && employee && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {loadingBalances ? (
                <span>Checking the balance…</span>
              ) : !type.affectsBalance ? (
                <span>
                  {type.name} consumes no entitlement.
                  {!type.isPaid && " It is deducted from the payslip instead."}
                </span>
              ) : balance ? (
                <span>
                  <strong className="text-foreground">{balance.availableDays}</strong>{" "}
                  day(s) available — {balance.entitledDays + balance.carryOverDays}{" "}
                  entitled, {balance.takenDays} taken, {balance.pendingDays} awaiting
                  a decision.
                </span>
              ) : (
                <span>No entitlement is set for this leave type yet.</span>
              )}
              {type.requiresDocument && (
                <span className="ml-1">Supporting documents are expected.</span>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="halfDay"
            value="true"
            checked={halfDay}
            onChange={(e) => {
              setHalfDay(e.target.checked);
              if (e.target.checked && fromDate) setToDate(fromDate);
            }}
            className="accent-primary"
          />
          Half day
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label required>From</Label>
            <input
              name="fromDate"
              type="date"
              value={fromDate}
              min={today()}
              onChange={(e) => {
                setFromDate(e.target.value);
                // A half day is one day, so the end follows the start.
                if (halfDay || !toDate || toDate < e.target.value) {
                  setToDate(e.target.value);
                }
              }}
              className={inputClass(!!state.fieldErrors?.fromDate)}
            />
            {state.fieldErrors?.fromDate && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.fromDate}</p>
            )}
          </div>
          <div>
            <Label required>To</Label>
            <input
              name="toDate"
              type="date"
              value={toDate}
              min={fromDate || today()}
              disabled={halfDay}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass(!!state.fieldErrors?.toDate)}
            />
            {state.fieldErrors?.toDate && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.toDate}</p>
            )}
          </div>
        </div>

        {halfDay && (
          <div>
            <Label>Which half</Label>
            <select name="halfDayPeriod" className={inputClass(false)} defaultValue="morning">
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
            </select>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Weekends and this company&apos;s public holidays are excluded from the
          count automatically.
        </p>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <div>
          <Label>Reason</Label>
          <textarea
            name="reason"
            rows={3}
            placeholder="Optional, but it helps whoever approves it"
            className={inputClass(false)}
          />
        </div>
        <div>
          <Label>Handover notes</Label>
          <textarea
            name="handoverNotes"
            rows={2}
            placeholder="What needs covering while you are away"
            className={inputClass(false)}
          />
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" asChild>
          <Link href="/dashboard/hr/leave">Cancel</Link>
        </Button>
        <Button type="submit" name="submitNow" value="false" variant="outline" disabled={isPending}>
          Save as draft
        </Button>
        <Button type="submit" name="submitNow" value="true" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Sending…" : "Submit for approval"}
        </Button>
      </div>
    </form>
  );
}
