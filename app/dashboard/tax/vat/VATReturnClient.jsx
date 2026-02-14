"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  Download,
  ExternalLink,
  Receipt,
  FileSpreadsheet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
};

const formatPeriodLabel = (period) => {
  if (!period) return "Current Period";
  const [year, month] = period.split("-");
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-KE", { year: "numeric", month: "long" });
};

export default function VATReturnClient({ vatData, periods, initialPeriod, transactions }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedPeriod, setSelectedPeriod] = useState(
    initialPeriod || vatData?.filingPeriod || ""
  );
  const [isExporting, setIsExporting] = useState(false);

  const handlePeriodChange = (period) => {
    setSelectedPeriod(period);
    const params = new URLSearchParams(searchParams);
    if (period) {
      params.set("period", period);
    } else {
      params.delete("period");
    }
    router.push(`/dashboard/tax/vat?${params.toString()}`);
  };

  // Export VAT data to CSV for iTax preparation
  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      const outputTxns = transactions?.output || [];
      const inputTxns = transactions?.input || [];

      // Build CSV for VAT Output (Sales)
      let csv = "VAT RETURN - " + formatPeriodLabel(vatData?.filingPeriod) + "\n\n";
      csv += "OUTPUT VAT (SALES)\n";
      csv += "Date,Document No,Customer,KRA PIN,Base Amount,VAT Amount,Total\n";

      outputTxns.forEach(txn => {
        csv += `${txn.transactionDate?.split('T')[0] || ''},${txn.sourceDocument?.number || ''},"${txn.party?.name || ''}",${txn.party?.taxPin || ''},${txn.baseAmount || 0},${txn.taxAmount || 0},${txn.totalAmount || 0}\n`;
      });

      csv += `\nSubtotal Output VAT,,,,,${output?.totalVAT || 0},\n\n`;

      // Build CSV for VAT Input (Purchases)
      csv += "INPUT VAT (PURCHASES)\n";
      csv += "Date,Document No,Supplier,KRA PIN,Base Amount,VAT Amount,Total\n";

      inputTxns.forEach(txn => {
        csv += `${txn.transactionDate?.split('T')[0] || ''},${txn.sourceDocument?.number || ''},"${txn.party?.name || ''}",${txn.party?.taxPin || ''},${txn.baseAmount || 0},${txn.taxAmount || 0},${txn.totalAmount || 0}\n`;
      });

      csv += `\nSubtotal Input VAT,,,,,${input?.totalVAT || 0},\n\n`;

      // Summary
      csv += "SUMMARY\n";
      csv += `Output VAT,${output?.totalVAT || 0}\n`;
      csv += `Less: Input VAT,${input?.totalVAT || 0}\n`;
      csv += `Net VAT ${netPosition >= 0 ? 'Payable' : 'Refundable'},${Math.abs(netPosition)}\n`;

      // Download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `VAT_Return_${vatData?.filingPeriod || 'current'}.csv`;
      link.click();
    } finally {
      setIsExporting(false);
    }
  };

  const { input, output, summary } = vatData || {};
  const netPosition = summary?.netPosition || 0;
  const isPayable = netPosition > 0;

  // Transaction lists for drill-down
  const outputTransactions = transactions?.output || [];
  const inputTransactions = transactions?.input || [];

  return (
    <div className="space-y-4">
      {/* Period Selector & Export */}
      <div className="flex items-center justify-end gap-2">
        <Select value={selectedPeriod} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-full sm:w-45 h-9 text-sm">
            <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periods?.map((period) => (
              <SelectItem key={period} value={period}>
                {formatPeriodLabel(period)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={isExporting}
          className="gap-2"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
      </div>

      {/* VAT Breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Sales VAT (Output) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-red-500" />
              Sales VAT (Output)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">Total Sales</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(output?.totalSales)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">VAT @ 16%</span>
              <span className="font-medium text-red-600 tabular-nums">
                {formatCurrency(output?.totalVAT)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">
                Transactions
              </span>
              <span className="font-medium">{output?.transactionCount || 0}</span>
            </div>
            {output?.unfiledCount > 0 && (
              <div className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <span className="text-xs text-yellow-700 dark:text-yellow-400">
                  {output.unfiledCount} transactions not yet filed
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Purchase VAT (Input) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-green-500" />
              Purchase VAT (Input)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">
                Total Purchases
              </span>
              <span className="font-medium tabular-nums">
                {formatCurrency(input?.totalPurchases)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">VAT @ 16%</span>
              <span className="font-medium text-green-600 tabular-nums">
                {formatCurrency(input?.totalVAT)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">
                Transactions
              </span>
              <span className="font-medium">{input?.transactionCount || 0}</span>
            </div>
            {input?.unfiledCount > 0 && (
              <div className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <span className="text-xs text-yellow-700 dark:text-yellow-400">
                  {input.unfiledCount} transactions not yet filed
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* VAT Calculation Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">
            VAT Return Summary - {formatPeriodLabel(vatData?.filingPeriod)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-3 border-b">
              <span className="text-sm sm:text-base">
                Output VAT (on sales)
              </span>
              <span className="font-medium text-red-600 tabular-nums">
                {formatCurrency(output?.totalVAT)}
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b">
              <span className="text-sm sm:text-base">
                Less: Input VAT (on purchases)
              </span>
              <span className="font-medium text-green-600 tabular-nums">
                ({formatCurrency(input?.totalVAT)})
              </span>
            </div>
            <div
              className={`flex justify-between items-center py-3 rounded-lg px-3 ${isPayable ? "bg-orange-50 dark:bg-orange-900/20" : "bg-blue-50 dark:bg-blue-900/20"}`}
            >
              <span className="text-sm sm:text-base font-semibold">
                {isPayable ? "VAT Payable to KRA" : "VAT Refundable from KRA"}
              </span>
              <span
                className={`text-lg sm:text-xl font-bold tabular-nums ${isPayable ? "text-orange-600" : "text-blue-600"}`}
              >
                {formatCurrency(Math.abs(netPosition))}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" className="flex-1" disabled>
              <FileText className="w-4 h-4 mr-2" />
              Export for iTax
            </Button>
            <Button
              className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
              disabled
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark as Filed
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Filing features coming soon
          </p>
        </CardContent>
      </Card>

      {/* Transaction Drill-down Tables */}
      {(outputTransactions.length > 0 || inputTransactions.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Output VAT Transactions */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-red-500" />
                  Sales Invoices ({outputTransactions.length})
                </CardTitle>
                <Link
                  href={`/dashboard/tax/transactions?taxType=vat_output&period=${selectedPeriod}`}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  View all <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {outputTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Doc #</TableHead>
                        <TableHead className="text-xs">Customer</TableHead>
                        <TableHead className="text-xs text-right">VAT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outputTransactions.slice(0, 5).map((txn) => (
                        <TableRow key={txn._id} className="text-xs">
                          <TableCell className="py-2">
                            {txn.transactionDate?.split("T")[0]}
                          </TableCell>
                          <TableCell className="py-2 font-mono">
                            {txn.sourceDocument?.number || "-"}
                          </TableCell>
                          <TableCell className="py-2 truncate max-w-[100px]">
                            {txn.party?.name || "-"}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums text-red-600">
                            {formatCurrency(txn.taxAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {outputTransactions.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      +{outputTransactions.length - 5} more transactions
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No sales VAT transactions for this period
                </p>
              )}
            </CardContent>
          </Card>

          {/* Input VAT Transactions */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-green-500" />
                  Purchase Bills ({inputTransactions.length})
                </CardTitle>
                <Link
                  href={`/dashboard/tax/transactions?taxType=vat_input&period=${selectedPeriod}`}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  View all <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {inputTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Doc #</TableHead>
                        <TableHead className="text-xs">Supplier</TableHead>
                        <TableHead className="text-xs text-right">VAT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inputTransactions.slice(0, 5).map((txn) => (
                        <TableRow key={txn._id} className="text-xs">
                          <TableCell className="py-2">
                            {txn.transactionDate?.split("T")[0]}
                          </TableCell>
                          <TableCell className="py-2 font-mono">
                            {txn.sourceDocument?.number || "-"}
                          </TableCell>
                          <TableCell className="py-2 truncate max-w-[100px]">
                            {txn.party?.name || "-"}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums text-green-600">
                            {formatCurrency(txn.taxAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {inputTransactions.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      +{inputTransactions.length - 5} more transactions
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No purchase VAT transactions for this period
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* iTax Preparation Guide */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                iTax Filing Guide
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Export your VAT data above, then file on{" "}
                <a
                  href="https://itax.kra.go.ke"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:no-underline"
                >
                  iTax Portal
                </a>
                . VAT returns are due by the 20th of the following month.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
