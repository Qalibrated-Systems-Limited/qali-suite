"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createLead } from "@/app/mongodb/actions/lead-actions";

const SOURCES = [
  "website",
  "referral",
  "walk_in",
  "campaign",
  "cold_call",
  "trade_show",
  "social",
  "other",
];

const initialState = { success: false, error: null };

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function LeadCreateForm() {
  const router = useRouter();
  const formRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    createLead,
    initialState,
  );

  useEffect(() => {
    if (state.success) {
      toast.success(`Lead ${state.data?.leadNumber || ""} created`);
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> New lead
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <form
            ref={formRef}
            action={formAction}
            className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Name *</label>
              <input name="name" required className={inputCls} placeholder="Jane Wanjiru" />
              {state.fieldErrors?.name && (
                <p className="mt-1 text-xs text-red-500">{state.fieldErrors.name[0]}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Company</label>
              <input name="company" className={inputCls} placeholder="Westlands Garage" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Title</label>
              <input name="title" className={inputCls} placeholder="Procurement lead" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email</label>
              <input name="email" type="email" className={inputCls} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Phone</label>
              <input name="phone" className={inputCls} placeholder="+254…" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Source</label>
              <select name="source" defaultValue="other" className={inputCls}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Estimated value (KES)</label>
              <input
                name="estimatedValue"
                type="number"
                min="0"
                step="any"
                defaultValue="0"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Create lead
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
