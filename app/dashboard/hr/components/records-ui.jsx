"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

/**
 * Shared pieces for the HR record screens (letters, cases, training, reviews,
 * recruitment), in the same look as the Exits screens.
 */

import { inputClass } from "./records-styles";
export { inputClass };

export function Field({ label, hint, error, children, className = "" }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function EmployeePicker({ employees = [], value, onChange, name = "employeeId", disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = employees.find((e) => e.id === value) || null;
  const filtered = search
    ? employees.filter((e) =>
        `${e.name} ${e.employeeNumber} ${e.department ?? ""}`.toLowerCase().includes(search.toLowerCase()),
      )
    : employees;
  return (
    <>
      <input type="hidden" name={name} value={value || ""} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={`flex w-full items-center justify-between ${inputClass(false)}`}
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
                    <span className="font-medium">{emp.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {emp.employeeNumber}
                      {emp.department ? ` · ${emp.department}` : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

const TONES = {
  gray: "bg-muted text-muted-foreground",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function Badge({ tone = "gray", children }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.gray}`}>{children}</span>;
}

export function Button({ children, variant = "primary", pending = false, className = "", ...props }) {
  const look =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : variant === "danger"
        ? "border border-destructive/40 text-destructive hover:bg-destructive/10"
        : "border border-border bg-background text-foreground hover:bg-accent";
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${look} ${className}`}
      disabled={pending || props.disabled}
      {...props}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/**
 * Runs a server action that returns { success, message | error }: a toast for
 * the result and a refresh, or `onDone` (e.g. to navigate) on success.
 */
export function useRunAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn, onDone) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        if (res.message) toast.success(res.message);
        if (onDone) onDone(res);
        else router.refresh();
      } else {
        toast.error(res?.error || "Something went wrong");
      }
    });
  return [pending, run];
}

export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "", actions }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">{children}</div>;
}
