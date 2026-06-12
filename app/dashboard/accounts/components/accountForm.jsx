"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAccount,
  updateAccount,
} from "@/app/mongodb/actions/account-actions";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoIcon, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
];

const SUB_TYPES = [
  { value: "header", label: "Header (Cannot post transactions)" },
  { value: "employee_expense", label: "Employee Expense" },
  { value: "employee_payables", label: "Employee Payables" },
  { value: "employee_advance", label: "Employee Advance" },
  { value: "operating_expense", label: "Operating Expense" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "current_asset", label: "Current Asset" },
  { value: "fixed_asset", label: "Fixed Asset" },
  { value: "current_liability", label: "Current Liability" },
  { value: "long_term_liability", label: "Long-term Liability" },
  { value: "equity", label: "Equity" },
  { value: "revenue", label: "Revenue" },
  { value: "cogs", label: "Cost of Goods Sold" },
  { value: "expense", label: "Expense" },
  { value: "inventory_adjustment", label: "Inventory Adjustment" },
];

const SYSTEM_ACCOUNTS = [
  { value: "accounts_receivable", label: "Accounts Receivable" },
  { value: "accounts_payable", label: "Accounts Payable" },
  { value: "inventory", label: "Inventory" },
  { value: "cogs", label: "Cost of Goods Sold" },
  { value: "sales_revenue", label: "Sales Revenue" },

  { value: "vat_input", label: "VAT Input" },
  { value: "vat_output", label: "VAT Output" },
  { value: "wht_payable", label: "WHT Payable" },
  { value: "employee_advance", label: "Employee Advances" },
  { value: "employee_payables", label: "Employee Payables" },
];

// Expense subtypes that live in the 5xxx (cost-of-sales) range — must
// match DIRECT_COST_SUBTYPES in lib/coa-codes.js.
const DIRECT_COST_SUBTYPES = ["cogs", "direct_cost", "adjustment", "inventory_adjustment"];

export default function AccountForm({ account = null, headerAccounts = [], nextCodes = {} }) {
  const router = useRouter();
  const isEdit = !!account;

  // State for parent account combobox
  const [parentOpen, setParentOpen] = useState(false);
  const [parentValue, setParentValue] = useState("");

  // State for subType combobox
  const [subTypeOpen, setSubTypeOpen] = useState(false);
  const [subTypeValue, setSubTypeValue] = useState(account?.subType || "");

  // Auto-suggest the account code from the selected type (and, for
  // expenses, the subtype's range). Stops the moment the user types a
  // code of their own.
  const [typeValue, setTypeValue] = useState(account?.accountType || "");
  const [codeValue, setCodeValue] = useState(account?.accountCode || "");
  const [codeTouched, setCodeTouched] = useState(isEdit);

  useEffect(() => {
    if (isEdit || codeTouched || !typeValue) return;
    const key =
      typeValue === "expense" && DIRECT_COST_SUBTYPES.includes(subTypeValue)
        ? "direct_cost"
        : typeValue;
    const suggestion = nextCodes[key];
    if (suggestion) setCodeValue(suggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeValue, subTypeValue, codeTouched, isEdit]);

  // Use different action based on mode
  const action = isEdit ? updateAccount.bind(null, account._id) : createAccount;
  const [state, formAction, isPending] = useActionState(action, {});

  // Handle success
  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
      if (isEdit) {
        router.push(`/dashboard/accounts/${account._id}`);
      } else {
        router.push("/dashboard/accounts");
      }
    }
  }, [state.success, state.message, router, isEdit, account]);

  // System account is read-only in edit mode
  const isSystemAccount = isEdit && account.systemAccount;

  return (
    <form action={formAction} className="space-y-6">
      {/* General Error */}
      {state.errors?._form && (
        <Alert variant="destructive">
          <AlertDescription>{state.errors._form[0]}</AlertDescription>
        </Alert>
      )}

      {/* System Account Warning */}
      {isSystemAccount && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            This is a system account. Some fields cannot be modified to maintain
            system integrity.
          </AlertDescription>
        </Alert>
      )}

      {/* SECTION 1: Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Account Code */}
            <div className="space-y-2">
              <Label htmlFor="accountCode">
                Account Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="accountCode"
                name="accountCode"
                value={codeValue}
                onChange={(e) => {
                  setCodeValue(e.target.value);
                  setCodeTouched(true);
                }}
                placeholder="Pick a type to auto-suggest"
                className="font-mono bg-background"
                disabled={isEdit}
                required
              />
              {state.errors?.accountCode && (
                <p className="text-sm text-destructive">
                  {state.errors.accountCode[0]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Suggested from the type (1xxx assets … 4xxx revenue, 5xxx
                direct costs, 6xxx expenses) — edit freely.
              </p>
            </div>

            {/* Account Name */}
            <div className="space-y-2">
              <Label htmlFor="accountName">
                Account Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="accountName"
                name="accountName"
                defaultValue={account?.accountName || ""}
                placeholder="e.g., Cash in Hand"
                className="bg-background"
                required
              />
              {state.errors?.accountName && (
                <p className="text-sm text-destructive">
                  {state.errors.accountName[0]}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Account Type */}
            <div className="space-y-2">
              <Label htmlFor="accountType">
                Account Type <span className="text-destructive">*</span>
              </Label>
              <Select
                name="accountType"
                value={typeValue}
                onValueChange={setTypeValue}
                disabled={isEdit}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.errors?.accountType && (
                <p className="text-sm text-destructive">
                  {state.errors.accountType[0]}
                </p>
              )}
            </div>

            {/* Sub Type */}
            <div className="space-y-2">
              <Label htmlFor="subType">
                Sub Type <span className="text-destructive">*</span>
              </Label>

              {/* Hidden input for form submission */}
              <input
                type="hidden"
                name="subType"
                value={subTypeValue}
                required
              />

              {/* Searchable Combobox */}
              <Popover open={subTypeOpen} onOpenChange={setSubTypeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={subTypeOpen}
                    className="w-full justify-between"
                    disabled={isEdit}
                    type="button"
                  >
                    {subTypeValue
                      ? SUB_TYPES.find((type) => type.value === subTypeValue)
                          ?.label
                      : "Select sub-type..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Search sub-type..." />
                    <CommandList>
                      <CommandEmpty>No sub-type found.</CommandEmpty>
                      <CommandGroup>
                        {SUB_TYPES.map((type) => (
                          <CommandItem
                            key={type.value}
                            value={type.label}
                            onSelect={() => {
                              setSubTypeValue(
                                type.value === subTypeValue ? "" : type.value
                              );
                              setSubTypeOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                subTypeValue === type.value
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            {type.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {state.errors?.subType && (
                <p className="text-sm text-destructive">
                  {state.errors.subType[0]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Header accounts cannot have transactions posted to them
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: Hierarchy (Only for create) - COMBOBOX */}
      {!isEdit && headerAccounts && headerAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Account Hierarchy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="parentId">Parent Account (Optional)</Label>

              {/* Hidden input for form submission */}
              <input type="hidden" name="parentId" value={parentValue} />

              {/* Combobox - Exact shadcn pattern */}
              <Popover open={parentOpen} onOpenChange={setParentOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={parentOpen}
                    className="w-full justify-between"
                  >
                    {parentValue
                      ? headerAccounts.find((acc) => acc._id === parentValue)
                          ?.accountCode +
                        " - " +
                        headerAccounts.find((acc) => acc._id === parentValue)
                          ?.accountName
                      : "Select parent account..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Search account..." />
                    <CommandList>
                      <CommandEmpty>No account found.</CommandEmpty>
                      <CommandGroup>
                        {headerAccounts.map((acc) => (
                          <CommandItem
                            key={acc._id}
                            value={`${acc.accountCode} ${acc.accountName}`}
                            onSelect={(currentValue) => {
                              // Find the account that matches the selected label
                              const selectedAccount = headerAccounts.find(
                                (account) =>
                                  `${account.accountCode} ${account.accountName}`.toLowerCase() ===
                                  currentValue.toLowerCase()
                              );
                              setParentValue(
                                selectedAccount?._id === parentValue
                                  ? ""
                                  : selectedAccount?._id || ""
                              );
                              setParentOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                parentValue === acc._id
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            {acc.accountCode} - {acc.accountName}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {state.errors?.parentId && (
                <p className="text-sm text-destructive">
                  {state.errors.parentId[0]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Optional: Select a parent to create a sub-account. Leave empty
                for root account.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SECTION 3: System Account (Only for create) */}
      {!isEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">System Account (Optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="systemAccount">System Account Type</Label>
              <Select name="systemAccount">
                <SelectTrigger>
                  <SelectValue placeholder="None (Regular Account)" />
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_ACCOUNTS.map((sys) => (
                    <SelectItem key={sys.value} value={sys.value}>
                      {sys.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Alert>
                <InfoIcon className="h-4 w-4" />
                <AlertDescription>
                  System accounts are used by the system for specific operations
                  (e.g., AR, AP, VAT). Leave empty for regular accounts. Only
                  assign if you know what you're doing!
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SECTION 4: Additional Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Additional Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={account?.description || ""}
              rows={4}
              placeholder="Optional description..."
              className="bg-background resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Explain what this account is used for
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 5: Status (Edit only) */}
      {isEdit && !isSystemAccount && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Account Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                name="isActive"
                defaultChecked={account?.isActive || false}
              />
              <Label htmlFor="isActive" className="font-normal cursor-pointer">
                Account is Active
              </Label>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Inactive accounts won't appear in dropdowns
            </p>
          </CardContent>
        </Card>
      )}

      {/* Submit Buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-6 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600"
        >
          {isPending
            ? "Saving..."
            : isEdit
            ? "Update Account"
            : "Create Account"}
        </Button>
      </div>
    </form>
  );
}
