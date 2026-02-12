"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Printer, RefreshCw, Calendar } from "lucide-react";
import { useState } from "react";

const DATE_PRESETS = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "this-quarter", label: "This Quarter" },
  { value: "last-quarter", label: "Last Quarter" },
  { value: "this-year", label: "This Year" },
  { value: "last-year", label: "Last Year" },
  { value: "custom", label: "Custom Range" },
];

export function ReportHeader({
  title,
  subtitle,
  onDateChange,
  onRefresh,
  onExport,
  onPrint,
  isLoading = false,
  showComparison = false,
  datePreset = "this-month",
  asOfDate, // For point-in-time reports like Balance Sheet, Trial Balance
}) {
  const [preset, setPreset] = useState(datePreset);
  const [comparison, setComparison] = useState("none");

  const handlePresetChange = (value) => {
    setPreset(value);
    const dates = getDateRangeFromPreset(value);
    onDateChange?.(dates);
  };

  const getDateRangeFromPreset = (presetValue) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const quarter = Math.floor(month / 3);

    switch (presetValue) {
      case "this-month":
        return {
          startDate: new Date(year, month, 1),
          endDate: new Date(year, month + 1, 0),
        };
      case "last-month":
        return {
          startDate: new Date(year, month - 1, 1),
          endDate: new Date(year, month, 0),
        };
      case "this-quarter":
        return {
          startDate: new Date(year, quarter * 3, 1),
          endDate: new Date(year, quarter * 3 + 3, 0),
        };
      case "last-quarter":
        return {
          startDate: new Date(year, (quarter - 1) * 3, 1),
          endDate: new Date(year, quarter * 3, 0),
        };
      case "this-year":
        return {
          startDate: new Date(year, 0, 1),
          endDate: new Date(year, 11, 31),
        };
      case "last-year":
        return {
          startDate: new Date(year - 1, 0, 1),
          endDate: new Date(year - 1, 11, 31),
        };
      default:
        return {
          startDate: new Date(year, month, 1),
          endDate: new Date(year, month + 1, 0),
        };
    }
  };

  return (
    <div className="bg-card border-b border-border">
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Title Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            )}
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
            {onPrint && (
              <Button variant="outline" size="sm" onClick={onPrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            )}
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          {/* Date Range / As Of Date */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {asOfDate !== undefined ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">As of:</span>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => onDateChange?.({ asOfDate: e.target.value })}
                  className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
            ) : (
              <Select value={preset} onValueChange={handlePresetChange}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Comparison (for P&L) */}
          {showComparison && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Compare to:</span>
              <Select value={comparison} onValueChange={setComparison}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Comparison</SelectItem>
                  <SelectItem value="previous_period">Previous Period</SelectItem>
                  <SelectItem value="previous_year">Previous Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
