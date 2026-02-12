"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Loader2 } from "lucide-react";

export function StatementGenerator({ customers }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = () => {
    if (!customerId) return;

    setIsLoading(true);

    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    const queryString = params.toString();
    router.push(
      `/dashboard/statements/${customerId}${queryString ? `?${queryString}` : ""}`
    );
  };

  // Get current month's first and last day for quick select
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];

  // Last 3 months
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1)
    .toISOString()
    .split("T")[0];

  const formatCurrency = (amount) => {
    if (!amount) return "KES 0";
    return `KES ${Number(amount).toLocaleString("en-KE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Customer Select */}
        <div className="space-y-2 lg:col-span-2">
          <Label>Select Customer</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a customer..." />
            </SelectTrigger>
            <SelectContent>
              {customers.map((customer) => (
                <SelectItem key={customer._id.toString()} value={customer._id.toString()}>
                  <div className="flex items-center justify-between w-full">
                    <span>{customer.displayName || customer.name}</span>
                    {customer.cachedBalance > 0 && (
                      <span className="ml-2 text-xs text-red-500">
                        ({formatCurrency(customer.cachedBalance)})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Start Date */}
        <div className="space-y-2">
          <Label>From Date (Optional)</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        {/* End Date */}
        <div className="space-y-2">
          <Label>To Date (Optional)</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* Quick Date Presets */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStartDate("");
            setEndDate("");
          }}
        >
          All Time
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStartDate(firstOfMonth);
            setEndDate(lastOfMonth);
          }}
        >
          This Month
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStartDate(threeMonthsAgo);
            setEndDate(today.toISOString().split("T")[0]);
          }}
        >
          Last 3 Months
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const startOfYear = new Date(today.getFullYear(), 0, 1)
              .toISOString()
              .split("T")[0];
            setStartDate(startOfYear);
            setEndDate(today.toISOString().split("T")[0]);
          }}
        >
          Year to Date
        </Button>
      </div>

      {/* Generate Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleGenerate}
          disabled={!customerId || isLoading}
          className="min-w-[200px]"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Generate Statement
        </Button>
      </div>

      {/* Customer List with Balances */}
      {customers.length > 0 && (
        <div className="mt-8">
          <h3 className="font-medium mb-4">Customers with Outstanding Balances</h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 text-sm font-medium">Customer</th>
                  <th className="text-left p-3 text-sm font-medium">Email</th>
                  <th className="text-left p-3 text-sm font-medium">Phone</th>
                  <th className="text-right p-3 text-sm font-medium">Balance</th>
                  <th className="text-right p-3 text-sm font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {customers
                  .filter((c) => c.cachedBalance > 0)
                  .sort((a, b) => (b.cachedBalance || 0) - (a.cachedBalance || 0))
                  .slice(0, 10)
                  .map((customer) => (
                    <tr key={customer._id.toString()} className="border-t">
                      <td className="p-3">
                        <div className="font-medium">
                          {customer.displayName || customer.name}
                        </div>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {customer.email || "-"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {customer.phone || "-"}
                      </td>
                      <td className="p-3 text-right">
                        <span className="font-medium text-red-600">
                          {formatCurrency(customer.cachedBalance)}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCustomerId(customer._id.toString());
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Select
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
