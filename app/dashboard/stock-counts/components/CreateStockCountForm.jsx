"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createStockCountPg } from "@/app/db/actions/stock-count-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, EyeOff } from "lucide-react";

export function CreateStockCountForm({ categories = [] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createStockCountPg, null);

  // The sheet is not generated here — the next screen does that, because
  // generating it is what freezes the book and that should be a deliberate
  // second step rather than a side effect of naming the count.
  useEffect(() => {
    if (state?.success && state.countId) {
      router.push(`/dashboard/stock-counts/${state.countId}`);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.success && (
        <Alert className="bg-destructive/10 border-destructive/20">
          <Info className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive text-sm">
            {state.message}
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-card border-border">
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              placeholder="e.g. August month-end count"
            />
            <p className="text-xs text-muted-foreground">
              What this count is, so it can be found later.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="countDate">Count date</Label>
              <Input
                id="countDate"
                name="countDate"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="categoryId">Scope</Label>
              <Select name="categoryId" defaultValue="all">
                <SelectTrigger id="categoryId">
                  <SelectValue placeholder="Everything" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every active product</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The sheet records what was included, so renaming a category
                later cannot change what was counted.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <label className="flex items-start gap-3 cursor-pointer">
            {/* ORDER MATTERS. An unchecked checkbox submits nothing, so the
                hidden field is what carries "not blind" — and it sits AFTER
                the checkbox because `FormData.get` returns the FIRST value.
                Checked: "true" wins. Unchecked: only the hidden is sent. */}
            <input
              type="checkbox"
              name="isBlind"
              value="true"
              defaultChecked
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <input type="hidden" name="isBlind" value="false" />
            <span className="space-y-1">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5" />
                Blind count
              </span>
              <span className="block text-xs text-muted-foreground">
                The counter does not see what the system expects. A counter who
                can see the expected number tends to find it — this is the
                standard control, and the reviewer still sees everything.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Opening…" : "Open count"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
