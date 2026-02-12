"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, Calendar, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { createYearPeriods } from "@/app/mongodb/actions/fiscal-period-actions";

export default function CreateYearPeriodsButton() {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [periodType, setPeriodType] = useState("month");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const handleCreate = () => {
    setError("");
    setSuccess("");

    startTransition(async () => {
      const result = await createYearPeriods(parseInt(year), periodType);

      if (result.success) {
        setSuccess(`Created ${result.created} fiscal periods for ${year}.`);
        setTimeout(() => {
          setOpen(false);
          setSuccess("");
        }, 2000);
      } else {
        setError(result.error);
      }
    });
  };

  const handleOpenChange = (isOpen) => {
    setOpen(isOpen);
    if (!isOpen) {
      setError("");
      setSuccess("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Year Periods
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Create Fiscal Periods
          </DialogTitle>
          <DialogDescription>
            Create fiscal periods for an entire year. This will generate all
            monthly or quarterly periods automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="year">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="periodType">Period Type</Label>
            <Select value={periodType} onValueChange={setPeriodType}>
              <SelectTrigger id="periodType">
                <SelectValue placeholder="Select period type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Monthly (12 periods)</SelectItem>
                <SelectItem value="quarter">Quarterly (4 periods)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {periodType === "month"
                ? "Creates 12 monthly periods (January - December)"
                : "Creates 4 quarterly periods (Q1 - Q4)"}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending || !!success}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Periods
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
