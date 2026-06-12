"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Loader2,
  ChevronsUpDown,
  Check,
  AlertCircle,
} from "lucide-react";
import { quickCreateExpenseAccount } from "@/app/mongodb/actions/account-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const EXPENSE_SUB_TYPES = [
  { value: "direct_cost", label: "Direct Project Cost" },
  { value: "cogs", label: "Cost of Goods Sold" },
  { value: "operating_expense", label: "Operating Expense" },
  { value: "admin", label: "Admin" },
  { value: "transport", label: "Transport" },
  { value: "occupancy", label: "Occupancy" },
  { value: "communication", label: "Communication" },
  { value: "professional", label: "Professional Fees" },
  { value: "insurance", label: "Insurance" },
  { value: "financial", label: "Financial" },
  { value: "utilities_expense", label: "Utilities" },
  { value: "depreciation", label: "Depreciation" },
  { value: "other_expense", label: "Other" },
];

// Map subType values to friendly group labels
const SUB_TYPE_LABELS = {
  direct_cost: "Direct Project Costs",
  operating_expense: "Operating Expenses",
  admin: "Admin & Office",
  transport: "Transport & Travel",
  transport_expense: "Transport & Travel",
  travel_expense: "Transport & Travel",
  fuel_expense: "Transport & Travel",
  occupancy: "Rent & Occupancy",
  communication: "Communication",
  professional: "Professional Fees",
  insurance: "Insurance",
  financial: "Financial",
  depreciation: "Depreciation",
  employee_expense: "Employee Expenses",
  meals_expense: "Meals & Entertainment",
  utilities_expense: "Utilities",
  incidentals_expense: "Incidentals",
  accommodation_expense: "Accommodation",
  other_expense: "Other Expenses",
};

/**
 * Reusable expense account combobox with inline quick-create dialog.
 * Accounts are grouped by subType for easier navigation.
 *
 * Props:
 * - value: string (selected account _id)
 * - onValueChange: (id, code, name) => void
 * - accounts: array of { _id, accountCode, accountName, subType? }
 * - onAccountCreated: (account) => void — called when a new account is created inline
 * - placeholder: string (optional, default "Account...")
 * - className: string (optional, for the trigger button)
 */
export default function ExpenseAccountCombobox({
  value,
  onValueChange,
  accounts,
  onAccountCreated,
  placeholder = "Account...",
  className,
}) {
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [formValues, setFormValues] = useState({
    accountCode: "",
    accountName: "",
    subType: "operating_expense",
  });

  const selected = value ? accounts.find((a) => a._id === value) : null;

  // Group accounts by subType
  const grouped = useMemo(() => {
    const groups = {};
    for (const acc of accounts) {
      const label = SUB_TYPE_LABELS[acc.subType] || "General";
      if (!groups[label]) groups[label] = [];
      groups[label].push(acc);
    }
    // Sort group names, but put "General" last
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "General") return 1;
      if (b === "General") return -1;
      return a.localeCompare(b);
    });
  }, [accounts]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreateError("");

    const formData = new FormData(e.target);
    const result = await quickCreateExpenseAccount(formData);

    if (result.success) {
      const acc = result.account;
      onValueChange(acc._id, acc.accountCode, acc.accountName);
      onAccountCreated?.(acc);
      setDialogOpen(false);
      setFormValues({ accountCode: "", accountName: "", subType: "operating_expense" });
      toast.success(`Account ${acc.accountCode} created`);
    } else {
      setCreateError(result.error);
      if (result.values) {
        setFormValues(result.values);
      }
    }
    setCreating(false);
  }

  function openCreateDialog() {
    setDialogOpen(true);
  }

  const createButton = (
    <button
      type="button"
      onClick={openCreateDialog}
      className="flex items-center gap-2 w-full px-2 py-2 text-sm font-medium text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 rounded-md cursor-pointer transition-colors"
    >
      <div className="flex items-center justify-center h-5 w-5 rounded bg-yellow-500/15 shrink-0">
        <Plus className="h-3.5 w-3.5" />
      </div>
      Create expense account
    </button>
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "h-9 w-full justify-between font-normal text-sm",
              className,
            )}
          >
            {selected ? (
              <span className="truncate">
                {selected.accountName}
                <span className="text-muted-foreground ml-1.5 font-mono text-xs">
                  {selected.accountCode}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-75 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search accounts..." />
            <CommandList>
              <CommandEmpty>
                <div className="py-2 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    No account found.
                  </p>
                  {createButton}
                </div>
              </CommandEmpty>
              {grouped.map(([groupLabel, groupAccounts]) => (
                <CommandGroup key={groupLabel} heading={groupLabel}>
                  {groupAccounts.map((acc) => (
                    <CommandItem
                      key={acc._id}
                      value={`${acc.accountCode} ${acc.accountName}`}
                      onSelect={() => {
                        onValueChange(acc._id, acc.accountCode, acc.accountName);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === acc._id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{acc.accountName}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground pl-2">
                        {acc.accountCode}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
            <div className="border-t p-1">{createButton}</div>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Quick-create dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setCreateError("");
        }}
      >
        <DialogContent className="sm:max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Plus className="h-4 w-4 text-yellow-500" />
              New Expense Account
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            {createError && (
              <div className="flex items-center gap-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {createError}
              </div>
            )}

            <div className="space-y-2">
              <Label>
                Code <span className="text-red-500">*</span>
              </Label>
              <Input
                name="accountCode"
                placeholder="Leave blank to auto-assign"
                pattern="[0-9]*"
                className="font-mono"
                disabled={creating}
                autoFocus
                defaultValue={formValues.accountCode}
                key={`code-${formValues.accountCode}`}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to auto-assign the next free code (5xxx direct
                costs/COGS, 6xxx operating expenses)
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                name="accountName"
                placeholder="e.g. Training & Development"
                required
                disabled={creating}
                defaultValue={formValues.accountName}
                key={`name-${formValues.accountName}`}
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                name="subType"
                defaultValue={formValues.subType}
                key={`sub-${formValues.subType}`}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_SUB_TYPES.map((st) => (
                    <SelectItem key={st.value} value={st.value}>
                      {st.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                disabled={creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Account
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
