"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, AlertCircle, ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";
import { createExit, updateExit } from "@/app/db/actions/hr-exit-actions";
import { EXIT_TYPE_LABELS } from "@/lib/hr/final-dues";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const initial = { success: false, error: null, fieldErrors: null };

const EXIT_TYPE_HINTS = {
  resignation: "The employee gives notice. No notice pay; unserved notice can be recovered.",
  termination: "The employer gives notice. Unserved notice is paid in lieu (s.36).",
  summary_dismissal: "Gross misconduct (s.44). No notice pay.",
  redundancy: "Notice pay, plus severance of 15 days' pay per completed year (s.40).",
  retirement: "Retirement age reached. Leave and unpaid salary only.",
  contract_end: "A fixed-term contract expires. Leave and unpaid salary only.",
  death: "Dues are paid to the next of kin.",
  mutual_separation: "On agreed terms. Add any agreed sum as a manual line.",
};

const inputClass = (error) =>
  `w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "border-destructive" : "border-border"}`;

function Field({ label, hint, error, children }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function EmployeePicker({ employees, value, onChange, hasError }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = employees.find((e) => e.id === value) || null;
  const filtered = search
    ? employees.filter((e) =>
        `${e.name} ${e.employeeNumber} ${e.department ?? ""}`.toLowerCase().includes(search.toLowerCase()),
      )
    : employees;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={`flex w-full items-center justify-between ${inputClass(hasError)}`}
        >
          {selected ? (
            <span className="truncate">
              {selected.name}
              <span className="ml-2 text-muted-foreground">({selected.employeeNumber})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Choose an employee…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by name or number…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((emp) => (
                <CommandItem
                  key={emp.id}
                  value={emp.id}
                  onSelect={() => {
                    onChange(emp.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 shrink-0 ${value === emp.id ? "opacity-100" : "opacity-0"}`} />
                  <div className="min-w-0">
                    <span className="font-medium">{emp.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{emp.employeeNumber}</span>
                    {emp.status === "terminated" && (
                      <span className="ml-2 text-xs text-muted-foreground">· already terminated</span>
                    )}
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

/**
 * Starts an exit, or edits a draft one. In edit mode the employee is fixed and
 * the overrides and exit-interview notes appear.
 */
export default function ExitForm({ employees = [], exit = null, defaultEmployeeId = "" }) {
  const editing = Boolean(exit);
  const [state, formAction, isPending] = useActionState(editing ? updateExit : createExit, initial);
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [exitType, setExitType] = useState(exit?.exitType ?? "resignation");
  const fe = state.fieldErrors || {};

  useEffect(() => {
    if (state.success && state.message) toast.success(state.message);
  }, [state]);

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-sm sm:p-6">
      {editing && <input type="hidden" name="exitId" value={exit.id} />}
      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </div>
      )}

      {!editing && (
        <Field label="Employee" error={fe.employeeId}>
          <input type="hidden" name="employeeId" value={employeeId} />
          <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} hasError={fe.employeeId} />
        </Field>
      )}

      <Field label="How is the employment ending?" hint={EXIT_TYPE_HINTS[exitType]} error={fe.exitType}>
        <select
          name="exitType"
          value={exitType}
          onChange={(e) => setExitType(e.target.value)}
          className={inputClass(fe.exitType)}
        >
          {Object.entries(EXIT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Notice given on" hint="Leave blank if no notice was given.">
          <input type="date" name="noticeDate" defaultValue={exit?.noticeDate ?? ""} className={inputClass()} />
        </Field>
        <Field label="Last working day" error={fe.lastWorkingDate}>
          <input
            type="date"
            name="lastWorkingDate"
            required
            defaultValue={exit?.lastWorkingDate ?? ""}
            className={inputClass(fe.lastWorkingDate)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Notice period (days)" hint="28 days for a monthly-paid contract unless it says more (s.35).">
          <input
            type="number"
            name="noticePeriodDays"
            min="0"
            max="365"
            defaultValue={exit?.noticePeriodDays ?? 28}
            className={inputClass()}
          />
        </Field>
        {exitType === "resignation" && (
          <label className="flex items-start gap-2 pt-7 text-sm text-foreground">
            <input
              type="checkbox"
              name="recoverNoticeShortfall"
              defaultChecked={exit?.recoverNoticeShortfall ?? false}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span>
              Recover unserved notice from the dues
              <span className="block text-xs text-muted-foreground">Off unless the company chooses to charge it.</span>
            </span>
          </label>
        )}
      </div>

      <Field label="Internal reason" hint="For the file only. It never appears on the certificate of service.">
        <textarea name="reason" rows={2} defaultValue={exit?.reason ?? ""} className={inputClass()} />
      </Field>

      {editing && (
        <>
          <Field label="Exit interview notes">
            <textarea
              name="exitInterviewNotes"
              rows={3}
              defaultValue={exit?.exitInterviewNotes ?? ""}
              className={inputClass()}
            />
          </Field>
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Overrides</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Daily rate (KES)" hint="Blank: monthly gross ÷ 30.">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="dailyRate"
                  defaultValue={exit?.dailyRate ?? ""}
                  className={inputClass()}
                />
              </Field>
              <Field label="Untaken leave (days)" hint="Blank: worked out from the annual leave balance.">
                <input
                  type="number"
                  step="0.5"
                  name="leaveDaysOverride"
                  defaultValue={exit?.leaveDaysOverride ?? ""}
                  className={inputClass()}
                />
              </Field>
            </div>
          </details>
        </>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? "Save and recalculate" : "Start exit"}
        </button>
      </div>
    </form>
  );
}
