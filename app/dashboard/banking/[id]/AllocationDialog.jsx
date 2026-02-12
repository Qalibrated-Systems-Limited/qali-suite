"use client";

import { useState, useEffect } from "react";
import {
  X,
  FileText,
  Receipt,
  Wallet,
  Building2,
  Ban,
  Loader2,
  Search,
  Check,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Trash2,
  Split,
  ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  allocateToInvoice,
  allocateToBill,
  allocateToExpense,
  allocateToIncome,
  allocateAsTransfer,
  allocateWithSplit,
  allocateToMultipleInvoices,
  allocateToMultipleBills,
  excludeBankLine,
  getExpenseAccounts,
  getIncomeAccounts,
  getTransferAccounts,
  getAllPostableAccounts,
  searchMatchingInvoices,
  searchMatchingBills,
  searchPartiesForAllocation,
} from "@/app/mongodb/actions/bank-feed-actions";

// ============================================
// HELPERS
// ============================================
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(amount);
}

// ============================================
// ALLOCATION TYPES CONFIG
// ============================================
const ALLOCATION_TYPES = {
  debit: [
    { key: "bill", label: "Match to Bill", icon: Receipt, description: "Payment to supplier" },
    { key: "expense", label: "Record as Expense", icon: Wallet, description: "Direct expense (no bill)" },
    { key: "transfer", label: "Bank Transfer", icon: ArrowLeftRight, description: "Transfer to another account" },
    { key: "split", label: "Split Transaction", icon: Split, description: "Split across multiple accounts" },
    { key: "exclude", label: "Exclude", icon: Ban, description: "Skip this transaction" },
  ],
  credit: [
    { key: "invoice", label: "Match to Invoice", icon: FileText, description: "Payment from customer" },
    { key: "income", label: "Record as Income", icon: Wallet, description: "Direct income (no invoice)" },
    { key: "transfer", label: "Bank Transfer", icon: ArrowLeftRight, description: "Transfer from another account" },
    { key: "split", label: "Split Transaction", icon: Split, description: "Split across multiple accounts" },
    { key: "exclude", label: "Exclude", icon: Ban, description: "Skip this transaction" },
  ],
};

const EXCLUDE_REASONS = [
  { value: "duplicate", label: "Duplicate entry" },
  { value: "opening_balance", label: "Opening balance" },
  { value: "manual", label: "Already recorded manually" },
  { value: "other", label: "Other reason" },
];

// ============================================
// INVOICE/BILL MATCHER (supports multi-select)
// ============================================
function DocumentMatcher({ line, type, onBack, onComplete }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]); // Array for multi-select
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const amount = type === "invoice" ? line.creditAmount : line.debitAmount;
  const totalSelected = selected.reduce((sum, s) => sum + s.amount, 0);
  const remaining = amount - totalSelected;

  // Load suggestions
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const searchFunc = type === "invoice" ? searchMatchingInvoices : searchMatchingBills;
        const docs = await searchFunc(amount, search);
        setResults(docs);
      } catch (err) {
        console.error("Error loading documents:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [type, amount, search]);

  const toggleSelect = (doc) => {
    const existing = selected.find((s) => s.id === doc._id);
    if (existing) {
      setSelected(selected.filter((s) => s.id !== doc._id));
    } else {
      // Default amount is the lesser of balance due or remaining
      const allocAmount = Math.min(doc.balanceDue, remaining > 0 ? remaining : doc.balanceDue);
      setSelected([
        ...selected,
        {
          id: doc._id,
          number: type === "invoice" ? doc.invoiceNumber : doc.billNumber,
          partyName: type === "invoice" ? doc.customer?.name : doc.supplier?.name,
          balanceDue: doc.balanceDue,
          amount: allocAmount,
        },
      ]);
    }
  };

  const updateAmount = (id, newAmount) => {
    setSelected(
      selected.map((s) =>
        s.id === id ? { ...s, amount: Math.min(newAmount, s.balanceDue) } : s
      )
    );
  };

  const handleSubmit = async () => {
    if (selected.length === 0) return;

    setSubmitting(true);
    setError("");

    try {
      let result;

      if (selected.length === 1) {
        // Single document match
        const allocFunc = type === "invoice" ? allocateToInvoice : allocateToBill;
        result = await allocFunc(line._id, selected[0].id);
      } else {
        // Multi-document match
        const allocations = selected.map((s) => ({
          [type === "invoice" ? "invoiceId" : "billId"]: s.id,
          amount: s.amount,
        }));
        const allocFunc =
          type === "invoice" ? allocateToMultipleInvoices : allocateToMultipleBills;
        result = await allocFunc(line._id, allocations);
      }

      if (result.success) {
        onComplete();
      } else {
        setError(result.error || "Failed to allocate");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          Match to {type === "invoice" ? "Invoice(s)" : "Bill(s)"}
        </h3>
        <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
          {formatCurrency(amount)}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${type === "invoice" ? "invoices" : "bills"}...`}
          className="w-full pl-9 pr-4 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Selected Summary */}
      {selected.length > 0 && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Selected: {selected.length}</span>
            <span>Allocated: {formatCurrency(totalSelected)}</span>
          </div>
          {remaining > 0.01 && (
            <p className="text-xs text-amber-600">
              Remaining {formatCurrency(remaining)} will be recorded as advance/overpayment
            </p>
          )}
          {remaining < -0.01 && (
            <p className="text-xs text-red-600">
              Warning: Allocation exceeds bank amount by {formatCurrency(Math.abs(remaining))}
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground text-sm">
          No matching {type === "invoice" ? "invoices" : "bills"} found
        </div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {results.map((doc) => {
            const isSelected = selected.find((s) => s.id === doc._id);
            return (
              <div
                key={doc._id}
                className={`p-3 rounded-lg border transition-colors ${
                  isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => toggleSelect(doc)}
                >
                  <div>
                    <span className="font-medium">
                      {type === "invoice" ? doc.invoiceNumber : doc.billNumber}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      {type === "invoice" ? doc.customer?.name : doc.supplier?.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">{formatCurrency(doc.balanceDue)}</p>
                    {doc.dueDate && (
                      <p className="text-xs text-muted-foreground">
                        Due: {format(new Date(doc.dueDate), "MMM d")}
                      </p>
                    )}
                  </div>
                </div>

                {/* Amount input when selected */}
                {isSelected && (
                  <div className="mt-2 pt-2 border-t flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Amount:</span>
                    <input
                      type="number"
                      value={isSelected.amount}
                      onChange={(e) => updateAmount(doc._id, parseFloat(e.target.value) || 0)}
                      className="flex-1 px-2 py-1 rounded border text-sm"
                      step="0.01"
                      max={doc.balanceDue}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(selected.filter((s) => s.id !== doc._id));
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={selected.length === 0 || submitting || remaining < -0.01}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Allocating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Allocate {selected.length > 1 ? `(${selected.length})` : ""}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// EXPENSE/INCOME FORM
// ============================================
function ExpenseIncomeForm({ line, type, onBack, onComplete }) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [parties, setParties] = useState([]);
  const [partySearch, setPartySearch] = useState("");
  const [partySearchLoading, setPartySearchLoading] = useState(false);
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);
  const [formData, setFormData] = useState({
    accountId: "",
    description: line.description,
    partyId: "",
    partyName: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const amount = type === "expense" ? line.debitAmount : line.creditAmount;

  // Load accounts
  useEffect(() => {
    async function loadAccounts() {
      setLoading(true);
      try {
        const fetchFunc = type === "expense" ? getExpenseAccounts : getIncomeAccounts;
        const data = await fetchFunc();
        setAccounts(data);
      } catch (err) {
        console.error("Error loading accounts:", err);
      } finally {
        setLoading(false);
      }
    }
    loadAccounts();
  }, [type]);

  // Search parties when typing
  useEffect(() => {
    const searchTimeout = setTimeout(async () => {
      if (partySearch.length >= 2) {
        setPartySearchLoading(true);
        try {
          const results = await searchPartiesForAllocation(type, partySearch);
          setParties(results);
          setShowPartyDropdown(true);
        } catch (err) {
          console.error("Error searching parties:", err);
        } finally {
          setPartySearchLoading(false);
        }
      } else if (partySearch.length === 0) {
        setParties([]);
        setShowPartyDropdown(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout);
  }, [partySearch, type]);

  const selectParty = (party) => {
    setFormData((prev) => ({
      ...prev,
      partyId: party._id,
      partyName: party.name,
    }));
    setPartySearch(party.name);
    setShowPartyDropdown(false);
  };

  const clearParty = () => {
    setFormData((prev) => ({
      ...prev,
      partyId: "",
      partyName: "",
    }));
    setPartySearch("");
    setParties([]);
  };

  const handleSubmit = async () => {
    if (!formData.accountId) {
      setError("Please select an account");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const allocateFunc = type === "expense" ? allocateToExpense : allocateToIncome;
      const result = await allocateFunc(line._id, {
        accountId: formData.accountId,
        description: formData.description,
        partyId: formData.partyId || null,
        partyName: formData.partyName || partySearch || null,
      });

      if (result.success) {
        onComplete();
      } else {
        setError(result.error || "Failed to allocate");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Amount */}
      <div className="rounded-lg bg-muted/50 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">
            Record as {type === "expense" ? "Expense" : "Income"}
          </h3>
          <span
            className={`font-mono font-semibold text-lg ${
              type === "expense" ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {formatCurrency(amount)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {line.description}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Account Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              {type === "expense" ? "Expense" : "Income"} Account{" "}
              <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.accountId}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, accountId: e.target.value }))
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select account...</option>
              {accounts.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.accountCode} - {account.accountName}
                </option>
              ))}
            </select>
            {accounts.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No {type} accounts found. Please create accounts in Chart of Accounts.
              </p>
            )}
          </div>

          {/* Party Selection with Search */}
          <div className="relative">
            <label className="block text-sm font-medium mb-2">
              {type === "expense" ? "Vendor/Payee" : "Customer"}{" "}
              <span className="text-muted-foreground text-xs">(Optional)</span>
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={partySearch}
                onChange={(e) => {
                  setPartySearch(e.target.value);
                  if (formData.partyId && e.target.value !== formData.partyName) {
                    // User is typing something different, clear selected party
                    setFormData((prev) => ({ ...prev, partyId: "", partyName: "" }));
                  }
                }}
                onFocus={() => {
                  if (parties.length > 0) setShowPartyDropdown(true);
                }}
                placeholder={`Search ${type === "expense" ? "suppliers" : "customers"}...`}
                className="w-full pl-9 pr-8 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {(partySearch || formData.partyId) && (
                <button
                  type="button"
                  onClick={clearParty}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {partySearchLoading && (
                <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Party Dropdown */}
            {showPartyDropdown && parties.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border border-input rounded-md shadow-lg max-h-48 overflow-y-auto">
                {parties.map((party) => (
                  <button
                    key={party._id}
                    type="button"
                    onClick={() => selectParty(party)}
                    className="w-full px-3 py-2 text-left hover:bg-muted text-sm"
                  >
                    <p className="font-medium">{party.name}</p>
                    {party.email && (
                      <p className="text-xs text-muted-foreground">{party.email}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {formData.partyId && (
              <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                <Check className="h-3 w-3" />
                {type === "expense" ? "Supplier" : "Customer"} selected: {formData.partyName}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Enter description..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || !formData.accountId}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Allocating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Allocate {formatCurrency(amount)}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// TRANSFER FORM
// ============================================
function TransferForm({ line, onBack, onComplete }) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [targetAccountId, setTargetAccountId] = useState("");
  const [description, setDescription] = useState(line.description);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const amount = line.debitAmount > 0 ? line.debitAmount : line.creditAmount;
  const isOutgoing = line.debitAmount > 0;

  useEffect(() => {
    async function loadAccounts() {
      setLoading(true);
      try {
        const data = await getTransferAccounts(line.bankAccountId);
        setAccounts(data);
      } catch (err) {
        console.error("Error loading accounts:", err);
      } finally {
        setLoading(false);
      }
    }
    loadAccounts();
  }, [line.bankAccountId]);

  const handleSubmit = async () => {
    if (!targetAccountId) {
      setError("Please select a target account");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const result = await allocateAsTransfer(line._id, targetAccountId, description);

      if (result.success) {
        onComplete();
      } else {
        setError(result.error || "Failed to allocate");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Bank Transfer</h3>
        <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
          {formatCurrency(amount)}
        </span>
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-sm">
        <p>
          {isOutgoing ? "Transfer OUT to:" : "Transfer IN from:"}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              {isOutgoing ? "To Account" : "From Account"}{" "}
              <span className="text-red-500">*</span>
            </label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select account...</option>
              {accounts.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.accountCode} - {account.accountName} ({account.subType})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || !targetAccountId}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Allocating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Record Transfer
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// SPLIT FORM
// ============================================
function SplitForm({ line, onBack, onComplete }) {
  const [loading, setLoading] = useState(true);
  const [accountsByType, setAccountsByType] = useState({});
  const [splits, setSplits] = useState([{ accountId: "", amount: 0, description: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const amount = line.debitAmount > 0 ? line.debitAmount : line.creditAmount;
  const totalSplit = splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const remaining = amount - totalSplit;

  useEffect(() => {
    async function loadAccounts() {
      setLoading(true);
      try {
        const data = await getAllPostableAccounts();
        setAccountsByType(data);
      } catch (err) {
        console.error("Error loading accounts:", err);
      } finally {
        setLoading(false);
      }
    }
    loadAccounts();
  }, []);

  const addSplit = () => {
    setSplits([...splits, { accountId: "", amount: remaining > 0 ? remaining : 0, description: "" }]);
  };

  const removeSplit = (index) => {
    if (splits.length > 1) {
      setSplits(splits.filter((_, i) => i !== index));
    }
  };

  const updateSplit = (index, field, value) => {
    setSplits(
      splits.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSubmit = async () => {
    const validSplits = splits.filter((s) => s.accountId && s.amount > 0);

    if (validSplits.length === 0) {
      setError("Please add at least one valid split");
      return;
    }

    if (Math.abs(remaining) > 0.01) {
      setError(`Split total must equal ${formatCurrency(amount)}`);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const result = await allocateWithSplit(line._id, validSplits);

      if (result.success) {
        onComplete();
      } else {
        setError(result.error || "Failed to allocate");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  // Flatten accounts for select
  const allAccounts = Object.entries(accountsByType).flatMap(([type, accounts]) =>
    accounts.map((a) => ({ ...a, type }))
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Split Transaction</h3>
        <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
          {formatCurrency(amount)}
        </span>
      </div>

      {/* Split Summary */}
      <div
        className={`rounded-lg p-3 text-sm ${
          Math.abs(remaining) < 0.01
            ? "bg-emerald-50 dark:bg-emerald-900/20"
            : "bg-amber-50 dark:bg-amber-900/20"
        }`}
      >
        <div className="flex justify-between">
          <span>Total allocated:</span>
          <span className="font-mono">{formatCurrency(totalSplit)}</span>
        </div>
        <div className="flex justify-between">
          <span>Remaining:</span>
          <span className={`font-mono ${Math.abs(remaining) > 0.01 ? "text-amber-600" : "text-emerald-600"}`}>
            {formatCurrency(remaining)}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {splits.map((split, index) => (
            <div key={index} className="p-3 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Split {index + 1}</span>
                {splits.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => removeSplit(index)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>

              <select
                value={split.accountId}
                onChange={(e) => updateSplit(index, "accountId", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account...</option>
                {Object.entries(accountsByType).map(([type, accounts]) => (
                  <optgroup key={type} label={type}>
                    {accounts.map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.accountCode} - {account.accountName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <div className="flex gap-2">
                <input
                  type="number"
                  value={split.amount}
                  onChange={(e) => updateSplit(index, "amount", e.target.value)}
                  placeholder="Amount"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  step="0.01"
                />
                <input
                  type="text"
                  value={split.description}
                  onChange={(e) => updateSplit(index, "description", e.target.value)}
                  placeholder="Description (optional)"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addSplit} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Split
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitting || Math.abs(remaining) > 0.01}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Allocating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Allocate Split
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// EXCLUDE FORM
// ============================================
function ExcludeForm({ line, onBack, onComplete }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a reason");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const result = await excludeBankLine(line._id, reason, note);

      if (result.success) {
        onComplete();
      } else {
        setError(result.error || "Failed to exclude");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Exclude Transaction</h3>

      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
        This transaction will be skipped and won&apos;t create any journal entries.
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          Reason <span className="text-red-500">*</span>
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select reason...</option>
          {EXCLUDE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Note (Optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Add a note..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="destructive" onClick={handleSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Excluding...
            </>
          ) : (
            <>
              <Ban className="h-4 w-4 mr-2" />
              Exclude
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// TYPE SELECTOR
// ============================================
function TypeSelector({ line, onSelect, onClose }) {
  const isDebit = line.debitAmount > 0;
  const amount = isDebit ? line.debitAmount : line.creditAmount;
  const types = ALLOCATION_TYPES[isDebit ? "debit" : "credit"];

  return (
    <div className="space-y-4">
      {/* Transaction Summary */}
      <div className="rounded-lg bg-muted/50 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            {format(new Date(line.transactionDate), "MMM d, yyyy")}
          </span>
          <div className="flex items-center gap-1">
            {isDebit ? (
              <ArrowUpRight className="h-4 w-4 text-red-500" />
            ) : (
              <ArrowDownRight className="h-4 w-4 text-emerald-500" />
            )}
            <span
              className={`font-mono font-semibold ${
                isDebit ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {formatCurrency(amount)}
            </span>
          </div>
        </div>
        <p className="font-medium text-sm">{line.description}</p>
        {line.reference && (
          <p className="text-xs text-muted-foreground mt-1">Ref: {line.reference}</p>
        )}
      </div>

      {/* Allocation Options */}
      <div>
        <h3 className="text-sm font-medium mb-3">How would you like to allocate this?</h3>
        <div className="grid gap-2">
          {types.map((type) => (
            <button
              key={type.key}
              onClick={() => onSelect(type.key)}
              className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
            >
              <div className="p-2 rounded-md bg-muted">
                <type.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-sm">{type.label}</p>
                <p className="text-xs text-muted-foreground">{type.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t">
        <Button variant="outline" className="w-full" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ============================================
// MAIN DIALOG
// ============================================
export default function AllocationDialog({ line, onClose, onComplete }) {
  const [step, setStep] = useState("select");

  const handleSelect = (type) => {
    setStep(type);
  };

  const handleBack = () => {
    setStep("select");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Allocate Transaction</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4">
          {step === "select" && (
            <TypeSelector line={line} onSelect={handleSelect} onClose={onClose} />
          )}
          {step === "invoice" && (
            <DocumentMatcher
              line={line}
              type="invoice"
              onBack={handleBack}
              onComplete={onComplete}
            />
          )}
          {step === "bill" && (
            <DocumentMatcher
              line={line}
              type="bill"
              onBack={handleBack}
              onComplete={onComplete}
            />
          )}
          {step === "expense" && (
            <ExpenseIncomeForm
              line={line}
              type="expense"
              onBack={handleBack}
              onComplete={onComplete}
            />
          )}
          {step === "income" && (
            <ExpenseIncomeForm
              line={line}
              type="income"
              onBack={handleBack}
              onComplete={onComplete}
            />
          )}
          {step === "transfer" && (
            <TransferForm line={line} onBack={handleBack} onComplete={onComplete} />
          )}
          {step === "split" && (
            <SplitForm line={line} onBack={handleBack} onComplete={onComplete} />
          )}
          {step === "exclude" && (
            <ExcludeForm line={line} onBack={handleBack} onComplete={onComplete} />
          )}
        </div>
      </div>
    </div>
  );
}
