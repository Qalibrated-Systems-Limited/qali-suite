"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Loader2,
  Check,
  ChevronsUpDown,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { createManualJournalEntry } from "@/app/mongodb/actions/journal-actions";

// Group accounts by type for better UX
function groupAccountsByType(accounts) {
  const groups = {
    asset: { label: "Assets", accounts: [] },
    liability: { label: "Liabilities", accounts: [] },
    equity: { label: "Equity", accounts: [] },
    revenue: { label: "Revenue", accounts: [] },
    expense: { label: "Expenses", accounts: [] },
  };

  accounts.forEach((account) => {
    if (groups[account.accountType]) {
      groups[account.accountType].accounts.push(account);
    }
  });

  return Object.entries(groups).filter(([_, group]) => group.accounts.length > 0);
}

// Empty line template
const emptyLine = () => ({
  id: crypto.randomUUID(),
  accountId: "",
  debit: "",
  credit: "",
  description: "",
});

export default function JournalEntryForm({ accounts = [], entryTypes = [] }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createManualJournalEntry, null);

  // Form state
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [entryType, setEntryType] = useState("adjustment");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [postImmediately, setPostImmediately] = useState(false);
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);

  // Account picker state (track which line's picker is open)
  const [openPickerIndex, setOpenPickerIndex] = useState(null);

  // Group accounts for display
  const groupedAccounts = groupAccountsByType(accounts);

  // Calculate totals
  const totalDebit = lines.reduce(
    (sum, l) => sum + (parseFloat(l.debit) || 0),
    0
  );
  const totalCredit = lines.reduce(
    (sum, l) => sum + (parseFloat(l.credit) || 0),
    0
  );
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const difference = Math.abs(totalDebit - totalCredit);

  // Redirect on success
  useEffect(() => {
    if (state?.success && state.entryId) {
      router.push(`/dashboard/journal/${state.entryId}`);
    }
  }, [state, router]);

  // Line handlers
  const addLine = () => {
    setLines([...lines, emptyLine()]);
  };

  const removeLine = (index) => {
    if (lines.length <= 2) return; // Minimum 2 lines
    setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index, field, value) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };

    // If setting debit, clear credit and vice versa
    if (field === "debit" && value) {
      newLines[index].credit = "";
    } else if (field === "credit" && value) {
      newLines[index].debit = "";
    }

    setLines(newLines);
  };

  const selectAccount = (index, accountId) => {
    updateLine(index, "accountId", accountId);
    setOpenPickerIndex(null);
  };

  // Get account display name
  const getAccountDisplay = (accountId) => {
    const account = accounts.find((a) => a._id === accountId);
    if (!account) return null;
    return `${account.accountCode} - ${account.accountName}`;
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
    }).format(amount || 0);
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* Error display */}
      {state?.error && (
        <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Error</p>
            <p className="text-sm text-muted-foreground">{state.error}</p>
            {state.fieldErrors && (
              <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside">
                {Object.entries(state.fieldErrors).map(([field, errors]) => (
                  <li key={field}>
                    {field}: {errors.join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Entry Details */}
      <Card>
        <CardHeader>
          <CardTitle>Entry Details</CardTitle>
          <CardDescription>
            Basic information about the journal entry
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Entry Date */}
            <div className="space-y-2">
              <Label htmlFor="entryDate">Entry Date *</Label>
              <Input
                id="entryDate"
                name="entryDate"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
              />
            </div>

            {/* Entry Type */}
            <div className="space-y-2">
              <Label htmlFor="entryType">Entry Type *</Label>
              <Select
                name="entryType"
                value={entryType}
                onValueChange={setEntryType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entryTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Input
              id="description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Depreciation for December 2024"
              required
            />
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <Label htmlFor="reference">Reference (Optional)</Label>
            <Input
              id="reference"
              name="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g., DEP-2024-12"
            />
          </div>
        </CardContent>
      </Card>

      {/* Journal Lines */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Journal Lines</CardTitle>
              <CardDescription>
                Add debit and credit lines (must balance)
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="w-4 h-4 mr-2" />
              Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Lines Table */}
          <div className="space-y-3">
            {/* Header */}
            <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
              <div className="col-span-5">Account</div>
              <div className="col-span-2 text-right">Debit</div>
              <div className="col-span-2 text-right">Credit</div>
              <div className="col-span-2">Description</div>
              <div className="col-span-1"></div>
            </div>

            {/* Lines */}
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid sm:grid-cols-12 gap-2 p-3 bg-muted/30 rounded-lg"
              >
                {/* Hidden inputs for form submission */}
                <input
                  type="hidden"
                  name={`lines[${index}].accountId`}
                  value={line.accountId}
                />

                {/* Account Picker */}
                <div className="sm:col-span-5">
                  <Label className="sm:hidden text-xs mb-1 block">Account</Label>
                  <Popover
                    open={openPickerIndex === index}
                    onOpenChange={(open) =>
                      setOpenPickerIndex(open ? index : null)
                    }
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between font-normal text-left",
                          !line.accountId && "text-muted-foreground"
                        )}
                      >
                        <span className="truncate">
                          {getAccountDisplay(line.accountId) || "Select account..."}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search accounts..." />
                        <CommandList>
                          <CommandEmpty>No accounts found.</CommandEmpty>
                          {groupedAccounts.map(([type, group]) => (
                            <CommandGroup key={type} heading={group.label}>
                              {group.accounts.map((account) => (
                                <CommandItem
                                  key={account._id}
                                  value={`${account.accountCode} ${account.accountName}`}
                                  onSelect={() => selectAccount(index, account._id)}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      line.accountId === account._id
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  <span className="font-mono text-xs mr-2">
                                    {account.accountCode}
                                  </span>
                                  {account.accountName}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Debit */}
                <div className="sm:col-span-2">
                  <Label className="sm:hidden text-xs mb-1 block">Debit</Label>
                  <Input
                    type="number"
                    name={`lines[${index}].debit`}
                    value={line.debit}
                    onChange={(e) => updateLine(index, "debit", e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="text-right"
                  />
                </div>

                {/* Credit */}
                <div className="sm:col-span-2">
                  <Label className="sm:hidden text-xs mb-1 block">Credit</Label>
                  <Input
                    type="number"
                    name={`lines[${index}].credit`}
                    value={line.credit}
                    onChange={(e) => updateLine(index, "credit", e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="text-right"
                  />
                </div>

                {/* Line Description */}
                <div className="sm:col-span-2">
                  <Label className="sm:hidden text-xs mb-1 block">Note</Label>
                  <Input
                    name={`lines[${index}].description`}
                    value={line.description}
                    onChange={(e) =>
                      updateLine(index, "description", e.target.value)
                    }
                    placeholder="Note..."
                  />
                </div>

                {/* Remove Button */}
                <div className="sm:col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(index)}
                    disabled={lines.length <= 2}
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="mt-4 pt-4 border-t">
            <div className="grid sm:grid-cols-12 gap-2 px-1">
              <div className="sm:col-span-5 font-medium">Totals</div>
              <div
                className={cn(
                  "sm:col-span-2 text-right font-mono font-medium",
                  !isBalanced && "text-destructive"
                )}
              >
                {formatCurrency(totalDebit)}
              </div>
              <div
                className={cn(
                  "sm:col-span-2 text-right font-mono font-medium",
                  !isBalanced && "text-destructive"
                )}
              >
                {formatCurrency(totalCredit)}
              </div>
              <div className="sm:col-span-3"></div>
            </div>

            {/* Balance indicator */}
            {!isBalanced && (
              <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" />
                <span>
                  Entry is not balanced. Difference: {formatCurrency(difference)}
                </span>
              </div>
            )}

            {isBalanced && totalDebit > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                <span>Entry is balanced</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Additional Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes or explanations..."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="postImmediately"
            name="postImmediately"
            checked={postImmediately}
            onCheckedChange={setPostImmediately}
          />
          <input
            type="hidden"
            name="postImmediately"
            value={postImmediately ? "true" : "false"}
          />
          <Label htmlFor="postImmediately" className="cursor-pointer">
            Post immediately after saving
          </Label>
        </div>

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending || !isBalanced || totalDebit === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                {postImmediately ? "Save & Post" : "Save as Draft"}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
