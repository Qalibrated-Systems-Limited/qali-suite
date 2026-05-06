"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Tag,
  Package,
  Percent,
  Receipt,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateApprovalThresholds } from "@/app/mongodb/actions/threshold-actions";

const initialState = { success: false, error: null, fieldErrors: null };

const HIGH_RISK_OPTIONS = [
  { value: "physical_count", label: "Physical count" },
  { value: "damage", label: "Damage" },
  { value: "expiry", label: "Expiry" },
  { value: "theft", label: "Theft" },
  { value: "correction", label: "Correction" },
  { value: "write_off", label: "Write-off" },
  { value: "found", label: "Found" },
  { value: "other", label: "Other" },
];

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_240px] sm:items-start sm:gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function NumberInput({ name, defaultValue, suffix, ...rest }) {
  return (
    <div className="relative">
      <input
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        name={name}
        defaultValue={defaultValue}
        className="h-9 w-full rounded-md border border-border bg-background px-3 pr-12 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
        {...rest}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default function ApprovalThresholdsForm({ initial }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    updateApprovalThresholds,
    initialState,
  );

  const [highRisk, setHighRisk] = useState(initial.stockHighRiskTypes || []);

  const toggleRisk = (value) => {
    setHighRisk((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  useEffect(() => {
    if (state.success) {
      toast.success("Thresholds saved");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      {/* Hidden field carries the comma-list */}
      <input
        type="hidden"
        name="stockHighRiskTypes"
        value={highRisk.join(",")}
      />

      <Section
        icon={Package}
        title="Stock adjustments"
        description="When can stock adjustments be applied without finance approval?"
      >
        <FieldRow
          label="Auto-approve threshold"
          hint="Adjustments at or below this absolute KES value are auto-approved by Store Manager / Accountant. Above, route through approval."
        >
          <NumberInput
            name="stockAdjustmentValue"
            defaultValue={initial.stockAdjustmentValue}
            suffix="KES"
          />
        </FieldRow>

        <FieldRow
          label="High-risk types (always approval)"
          hint="These types ALWAYS route through approval regardless of value — audit-sensitive."
        >
          <div className="flex flex-wrap gap-1.5">
            {HIGH_RISK_OPTIONS.map((opt) => {
              const active = highRisk.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleRisk(opt.value)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                    active
                      ? "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400"
                      : "bg-muted text-muted-foreground ring-border hover:bg-muted/70"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </FieldRow>
      </Section>

      <Section
        icon={Tag}
        title="Pricing"
        description="Margin floor for selling-price changes."
      >
        <FieldRow
          label="Minimum margin floor"
          hint="Selling prices that would drop margin below this require approval (or override authority). 0 disables."
        >
          <NumberInput
            name="minimumMarginPercent"
            defaultValue={initial.minimumMarginPercent}
            suffix="%"
            max="100"
          />
        </FieldRow>
      </Section>

      <Section
        icon={Receipt}
        title="Credit notes"
        description="Customer credit / refund issuance authority."
      >
        <FieldRow
          label="Auto-issue threshold"
          hint="Sales Manager can issue credits up to this value directly. Above, finance approval."
        >
          <NumberInput
            name="creditNoteValue"
            defaultValue={initial.creditNoteValue}
            suffix="KES"
          />
        </FieldRow>
      </Section>

      <Section
        icon={Wallet}
        title="Bill payments"
        description="Two-eyes rule on supplier payment release."
      >
        <FieldRow
          label="Auto-release threshold"
          hint="Bill payments at or below this value can be released without secondary approval."
        >
          <NumberInput
            name="billPaymentValue"
            defaultValue={initial.billPaymentValue}
            suffix="KES"
          />
        </FieldRow>
      </Section>

      <Section
        icon={Percent}
        title="Sales discounts"
        description="Discount caps on customer-facing prices."
      >
        <FieldRow
          label="Discount cap (without approval)"
          hint="Discounts above this percentage need approval — protects against margin leakage."
        >
          <NumberInput
            name="discountCapPercent"
            defaultValue={initial.discountCapPercent}
            suffix="%"
            max="100"
          />
        </FieldRow>
      </Section>

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{state.error}</p>
        </div>
      )}

      {state.success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{state.message || "Saved."}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="min-w-[140px]">
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="mr-2 h-4 w-4" />
          )}
          Save thresholds
        </Button>
      </div>
    </form>
  );
}
