"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Trash2,
  Plus,
  CheckCircle2,
  Check,
  ChevronDown,
  Package,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { createGRN } from "@/app/mongodb/actions/grn-actions";

const PACKAGING = ["good", "damaged", "moisture", "tampered"];
const PHYSICAL = ["good", "broken", "deformed", "defective"];

const emptyLine = () => ({
  productId: "",
  description: "",
  sku: "",
  expectedQty: 0,
  receivedQty: 0,
  unit: "pcs",
  packagingCondition: "good",
  physicalCondition: "good",
  inspectionNotes: "",
  storageLocation: "",
});

/**
 * Per-line product picker. Matches the POForm / BillForm pattern so the
 * UX stays consistent. Filters client-side over a pre-fetched product
 * list to avoid per-keystroke server hits. On select, the parent line
 * gets productId AND sensible defaults (description, sku, unit) wired
 * from the product so operators don't re-type what we already know.
 */
function ProductPickerCell({
  products,
  value,
  selectedProduct,
  onSelect,
  onClear,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const display = selectedProduct
    ? `${selectedProduct.SKU} — ${selectedProduct.name}`
    : null;

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal text-sm h-9",
              !display && "text-muted-foreground",
            )}
          >
            {display ? (
              <span className="truncate flex items-center gap-2">
                <Package className="h-3 w-3 text-muted-foreground" />
                {display}
              </span>
            ) : (
              "Search product…"
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by name or SKU…"
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {value && (
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onClear?.();
                      setOpen(false);
                    }}
                  >
                    <X className="mr-2 h-4 w-4 text-muted-foreground" />
                    Clear selection
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandEmpty>No products match.</CommandEmpty>
              <CommandGroup heading="Products">
                {products
                  .filter((p) => {
                    if (!searchValue) return true;
                    const s = searchValue.toLowerCase();
                    return (
                      p.name?.toLowerCase().includes(s) ||
                      p.SKU?.toLowerCase().includes(s)
                    );
                  })
                  .slice(0, 25)
                  .map((p) => (
                    <CommandItem
                      key={p._id}
                      value={p._id}
                      onSelect={() => {
                        onSelect(p);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === p._id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {p.SKU}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function GRNForm({
  prefill,
  availablePOs = [],
  availableBills = [],
  products = [],
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [billPickerOpen, setBillPickerOpen] = useState(false);

  const [form, setForm] = useState(() => ({
    sourceType: prefill?.sourceType || "unscheduled",
    billId: prefill?.billId || "",
    purchaseOrderId: prefill?.purchaseOrderId || "",
    proformaInvoiceNumber: "",
    packingListNumber: "",
    supplierPartyId: prefill?.supplierPartyId || "",
    supplierName: prefill?.supplierName || "",
    receivedDate:
      prefill?.receivedDate || new Date().toISOString().slice(0, 10),
    notes: "",
    lines: prefill?.lines?.length ? prefill.lines : [emptyLine()],
  }));

  // Pre-fill lines + supplier when the user picks a bill from the
  // in-form picker. Mirrors the server-side prefill for ?fromBill=.
  // Only bills awaiting GRN (strict mode, GR/IR open) are passed in.
  const handleSelectBill = (billId) => {
    if (!billId) {
      setForm((f) => ({
        ...f,
        billId: "",
        supplierPartyId: "",
        supplierName: "",
        lines: [emptyLine()],
      }));
      return;
    }
    const bill = availableBills.find((b) => b._id?.toString() === billId);
    if (!bill) return;
    const lines = (bill.lines || [])
      .filter((l) => l.product?.id)
      .map((l) => ({
        productId: l.product.id?.toString?.() || l.product.id,
        description: l.description || l.product.name || "",
        sku: l.product.sku || "",
        expectedQty: l.quantity || 0,
        receivedQty: l.quantity || 0,
        unit: l.unit || "pcs",
        packagingCondition: "good",
        physicalCondition: "good",
        inspectionNotes: "",
        storageLocation: "",
      }));
    setForm((f) => ({
      ...f,
      sourceType: "bill",
      billId,
      supplierPartyId:
        bill.supplier?.partyId?.toString?.() || bill.supplier?.partyId || "",
      supplierName: bill.supplier?.name || "",
      lines: lines.length > 0 ? lines : [emptyLine()],
    }));
  };

  // Pre-fill lines + supplier when the user picks a PO from the in-form
  // picker (industry-standard "create GRN, then reference a PO" path).
  // Mirrors the server-side prefill we do when arriving with ?fromPO=.
  const handleSelectPO = (poId) => {
    if (!poId) {
      setForm((f) => ({
        ...f,
        purchaseOrderId: "",
        supplierPartyId: "",
        supplierName: "",
        lines: [emptyLine()],
      }));
      return;
    }
    const po = availablePOs.find((p) => p._id?.toString() === poId);
    if (!po) return;
    const lines = (po.availableLines || [])
      .filter((l) => l.product?.id && l.availableQuantity > 0)
      .map((l) => ({
        productId: l.product.id,
        description: l.description || l.product.name || "",
        sku: l.product.sku || "",
        expectedQty: l.availableQuantity,
        receivedQty: l.availableQuantity,
        unit: l.unit || "pcs",
        packagingCondition: "good",
        physicalCondition: "good",
        inspectionNotes: "",
        storageLocation: "",
      }));
    setForm((f) => ({
      ...f,
      sourceType: "purchase_order",
      purchaseOrderId: poId,
      supplierPartyId:
        po.supplier?.partyId?.toString?.() || po.supplier?.partyId || "",
      supplierName: po.supplier?.name || "",
      lines: lines.length > 0 ? lines : [emptyLine()],
    }));
  };

  // Build an id→product lookup once per render so each line can resolve
  // its current selection without scanning the list.
  const productsById = useMemo(() => {
    const m = new Map();
    for (const p of products) m.set(p._id, p);
    return m;
  }, [products]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  const removeLine = (i) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((_, idx) => idx !== i),
    }));
  const addLine = () =>
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));

  const handleSubmit = (e) => {
    e?.preventDefault();
    setError("");
    setSuccess("");

    // Surface validation errors before round-tripping to the server.
    if (!form.lines.length) {
      setError("Add at least one line.");
      return;
    }
    for (const [i, l] of form.lines.entries()) {
      if (!l.productId) {
        setError(`Line ${i + 1}: product is required.`);
        return;
      }
      if (!l.description) {
        setError(`Line ${i + 1}: description is required.`);
        return;
      }
      if (l.receivedQty == null || l.receivedQty < 0) {
        setError(`Line ${i + 1}: received qty must be ≥ 0.`);
        return;
      }
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.append(
        "payload",
        JSON.stringify({
          ...form,
          lines: form.lines.map((l) => ({
            ...l,
            expectedQty: Number(l.expectedQty) || 0,
            receivedQty: Number(l.receivedQty) || 0,
          })),
        }),
      );
      const res = await createGRN(null, fd);
      if (res?.success) {
        setSuccess("GRN created");
        router.push(`/dashboard/grn/${res.grnId}`);
      } else {
        setError(res?.error || "Failed to create GRN");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Source */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source">
          <select
            value={form.sourceType}
            onChange={(e) => {
              const next = e.target.value;
              setField("sourceType", next);
              if (next !== "purchase_order") {
                setField("purchaseOrderId", "");
              }
              if (next !== "bill") {
                setField("billId", "");
              }
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="bill">From Bill</option>
            <option value="purchase_order">From Purchase Order</option>
            <option value="unscheduled">Unscheduled receipt</option>
          </select>
        </Field>
        <Field label="Received date">
          <input
            type="date"
            value={form.receivedDate}
            onChange={(e) => setField("receivedDate", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </Field>

        {form.sourceType === "bill" && (
          <Field label="Bill (awaiting receipt)" full>
            <Popover open={billPickerOpen} onOpenChange={setBillPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={billPickerOpen}
                  className={cn(
                    "w-full justify-between font-normal",
                    !form.billId && "text-muted-foreground",
                  )}
                  disabled={availableBills.length === 0}
                >
                  {(() => {
                    const b = availableBills.find(
                      (x) => x._id?.toString() === form.billId,
                    );
                    if (b) {
                      return `${b.billNumber} — ${b.supplier?.name || "—"}`;
                    }
                    return availableBills.length === 0
                      ? "No bills awaiting receipt"
                      : "Select a bill to receive against...";
                  })()}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search bills..." />
                  <CommandList>
                    <CommandEmpty>No bill matches.</CommandEmpty>
                    <CommandGroup>
                      {availableBills.map((b) => {
                        const label = `${b.billNumber} ${b.supplier?.name || ""}`;
                        return (
                          <CommandItem
                            key={b._id}
                            value={label}
                            onSelect={() => {
                              handleSelectBill(b._id?.toString());
                              setBillPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.billId === b._id?.toString()
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{b.billNumber}</span>
                              <span className="text-xs text-muted-foreground">
                                {b.supplier?.name || "—"}
                              </span>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {availableBills.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Only strict-mode bills posted to GR/IR clearing and not yet
                received appear here.
              </p>
            )}
          </Field>
        )}

        {form.sourceType === "purchase_order" && (
          <Field label="Purchase Order" full>
            <Popover open={poPickerOpen} onOpenChange={setPoPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={poPickerOpen}
                  className={cn(
                    "w-full justify-between font-normal",
                    !form.purchaseOrderId && "text-muted-foreground",
                  )}
                  disabled={availablePOs.length === 0}
                >
                  {(() => {
                    const p = availablePOs.find(
                      (x) => x._id?.toString() === form.purchaseOrderId,
                    );
                    if (p) {
                      const outstanding = (p.availableLines || []).reduce(
                        (sum, l) => sum + (l.availableQuantity || 0),
                        0,
                      );
                      return `${p.poNumber} — ${p.supplier?.name || "—"}${
                        outstanding > 0 ? ` · ${outstanding} outstanding` : ""
                      }`;
                    }
                    return availablePOs.length === 0
                      ? "No open POs available"
                      : "Select a purchase order to receive against...";
                  })()}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search purchase orders..." />
                  <CommandList>
                    <CommandEmpty>No PO matches.</CommandEmpty>
                    <CommandGroup>
                      {availablePOs.map((p) => {
                        const outstanding = (p.availableLines || []).reduce(
                          (sum, l) => sum + (l.availableQuantity || 0),
                          0,
                        );
                        const label = `${p.poNumber} ${p.supplier?.name || ""}`;
                        return (
                          <CommandItem
                            key={p._id}
                            value={label}
                            onSelect={() => {
                              handleSelectPO(p._id?.toString());
                              setPoPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.purchaseOrderId === p._id?.toString()
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{p.poNumber}</span>
                              <span className="text-xs text-muted-foreground">
                                {p.supplier?.name || "—"}
                                {outstanding > 0
                                  ? ` · ${outstanding} units outstanding`
                                  : ""}
                              </span>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {availablePOs.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Only sent / confirmed / partially-received POs with
                outstanding lines appear here.
              </p>
            )}
          </Field>
        )}
        <Field label="Supplier name">
          <input
            type="text"
            value={form.supplierName}
            onChange={(e) => setField("supplierName", e.target.value)}
            placeholder="Supplier"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Proforma Invoice #">
          <input
            type="text"
            value={form.proformaInvoiceNumber}
            onChange={(e) => setField("proformaInvoiceNumber", e.target.value)}
            placeholder="(Optional)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Packing List #" full>
          <input
            type="text"
            value={form.packingListNumber}
            onChange={(e) => setField("packingListNumber", e.target.value)}
            placeholder="(Optional — for SOP cross-reference)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
      </div>

      {/* Lines */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            Items received & inspection
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </div>

        {form.lines.map((l, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Line {i + 1}
                  {l.sku && (
                    <span className="ml-2 text-xs font-mono text-muted-foreground">
                      {l.sku}
                    </span>
                  )}
                </p>
              </div>
              {form.lines.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(i)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Searchable picker over the tenant's active products.
                  When prefilled from a PO / Bill the line's product is
                  fixed (the prefilled line is a documented commitment
                  against that source) so the picker is disabled. */}
              <Field label="Product" full>
                <ProductPickerCell
                  products={products}
                  value={l.productId}
                  selectedProduct={productsById.get(l.productId) || null}
                  disabled={!!prefill?.lines?.[i]?.productId}
                  onSelect={(p) =>
                    setLine(i, {
                      productId: p._id,
                      sku: p.SKU || "",
                      // Only fill description/unit if the operator hasn't
                      // already typed something — don't clobber edits.
                      description: l.description || p.name || "",
                      unit: l.unit && l.unit !== "pcs" ? l.unit : p.unit || "pcs",
                    })
                  }
                  onClear={() =>
                    setLine(i, {
                      productId: "",
                      sku: "",
                    })
                  }
                />
                {/* Hidden submit value — server action reads `productId`
                    from the lines array via JSON, but kept consistent with
                    the rest of the line inputs. */}
                <input type="hidden" value={l.productId} readOnly />
              </Field>
              <Field label="Description">
                <input
                  type="text"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </Field>
              <Field label="Expected qty">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.expectedQty}
                  onChange={(e) => setLine(i, { expectedQty: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Received qty">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.receivedQty}
                  onChange={(e) => setLine(i, { receivedQty: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </Field>
              <Field label="Unit">
                <input
                  type="text"
                  value={l.unit}
                  onChange={(e) => setLine(i, { unit: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Storage location">
                <input
                  type="text"
                  value={l.storageLocation}
                  onChange={(e) =>
                    setLine(i, { storageLocation: e.target.value })
                  }
                  placeholder="Bin / shelf"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Packaging condition">
                <select
                  value={l.packagingCondition}
                  onChange={(e) =>
                    setLine(i, { packagingCondition: e.target.value })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {PACKAGING.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Physical condition">
                <select
                  value={l.physicalCondition}
                  onChange={(e) =>
                    setLine(i, { physicalCondition: e.target.value })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {PHYSICAL.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Inspection notes" full>
                <input
                  type="text"
                  value={l.inspectionNotes}
                  onChange={(e) =>
                    setLine(i, { inspectionNotes: e.target.value })
                  }
                  placeholder="Defects, damage, anomalies"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          rows={2}
          placeholder="Any additional remarks for the consignment as a whole"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-400 inline-flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button type="submit" disabled={isPending} className="gap-1.5">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Save as draft
        </Button>
      </div>

    </form>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
