"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Percent,
  Receipt,
  AlertTriangle,
  ChevronRight,
  Download,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function WHTReportClient({
  whtData,
  initialStartDate,
  initialEndDate,
  transactions = [],
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [isExporting, setIsExporting] = useState(false);

  const handleDateChange = () => {
    router.push(`/dashboard/tax/wht?startDate=${startDate}&endDate=${endDate}`);
  };

  // Export WHT data to CSV for iTax preparation
  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      let csv = `WHT REPORT - ${startDate} to ${endDate}\n\n`;
      csv += "WITHHOLDING TAX TRANSACTIONS\n";
      csv += "Date,Document No,Supplier,KRA PIN,WHT Rate,Base Amount,WHT Amount\n";

      transactions.forEach(txn => {
        csv += `${txn.transactionDate?.split('T')[0] || ''},${txn.sourceDocument?.number || ''},"${txn.party?.name || ''}",${txn.party?.taxPin || ''},${txn.taxRate || 0}%,${txn.baseAmount || 0},${txn.taxAmount || 0}\n`;
      });

      csv += `\nTOTAL WHT,,,,,${summary?.totalWHT || 0}\n`;
      csv += `Remitted,,,,,${summary?.remitted || 0}\n`;
      csv += `Pending Remittance,,,,,${summary?.unremitted || 0}\n\n`;

      // By Rate breakdown
      csv += "\nBREAKDOWN BY RATE\n";
      csv += "Rate,Transactions,Base Amount,WHT Amount\n";
      (byRate || []).forEach(item => {
        csv += `${item.taxRate}%,${item.count},${item.totalBase},${item.totalWHT}\n`;
      });

      // By Supplier breakdown
      csv += "\nTOP SUPPLIERS BY WHT\n";
      csv += "Supplier,KRA PIN,Transactions,Base Amount,WHT Amount\n";
      (bySupplier || []).forEach(s => {
        csv += `"${s.supplierName}",${s.taxPin || ''},${s.transactions},${s.totalBase},${s.totalWHT}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `WHT_Report_${startDate}_to_${endDate}.csv`;
      link.click();
    } finally {
      setIsExporting(false);
    }
  };

  const { summary, byRate, bySupplier } = whtData || {};

  return (
    <div className="space-y-4">
      {/* Date Filter & Export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Label htmlFor="startDate" className="sr-only">
              Start Date
            </Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <span className="text-muted-foreground">to</span>
          <div className="flex-1">
            <Label htmlFor="endDate" className="sr-only">
              End Date
            </Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>
        <Button
          onClick={handleDateChange}
          variant="outline"
          size="sm"
          className="h-9"
        >
          <Calendar className="w-4 h-4 mr-2" />
          Apply
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={isExporting}
          className="h-9 gap-2"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {/* Pending Alert */}
      {summary?.unremitted > 0 && (
        <div className="flex items-center gap-3 p-3 sm:p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
              {formatCurrency(summary.unremitted)} WHT pending remittance
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
              Due by 20th of following month
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-orange-300"
            disabled
          >
            Remit Now
          </Button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* WHT by Rate */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Percent className="w-5 h-5 text-purple-500" />
              WHT by Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byRate && byRate.length > 0 ? (
              <div className="space-y-3">
                {byRate.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-medium text-sm">
                        {item.taxCode || `WHT ${item.taxRate}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.count} transactions
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium tabular-nums">
                        {formatCurrency(item.totalWHT)}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Base: {formatCurrency(item.totalBase)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No WHT transactions for this period
              </p>
            )}
          </CardContent>
        </Card>

        {/* WHT by Supplier */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-500" />
              Top Suppliers by WHT
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bySupplier && bySupplier.length > 0 ? (
              <>
                {/* Mobile Card View */}
                <div className="md:hidden divide-y">
                  {bySupplier.map((supplier, idx) => (
                    <div key={idx} className="py-3 first:pt-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm truncate pr-2">
                          {supplier.supplierName}
                        </p>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                      {supplier.taxPin && (
                        <p className="text-xs text-muted-foreground mb-2">
                          PIN: {supplier.taxPin}
                        </p>
                      )}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground block">
                            WHT
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(supplier.totalWHT)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">
                            Base
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(supplier.totalBase)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">
                            Txns
                          </span>
                          <span className="font-medium">
                            {supplier.transactions}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium text-muted-foreground">
                          Supplier
                        </th>
                        <th className="text-right py-2 font-medium text-muted-foreground">
                          WHT
                        </th>
                        <th className="text-right py-2 font-medium text-muted-foreground">
                          Txns
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bySupplier.map((supplier, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2">
                            <p className="font-medium">
                              {supplier.supplierName}
                            </p>
                            {supplier.taxPin && (
                              <p className="text-xs text-muted-foreground">
                                {supplier.taxPin}
                              </p>
                            )}
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums">
                            {formatCurrency(supplier.totalWHT)}
                          </td>
                          <td className="py-2 text-right">
                            {supplier.transactions}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No suppliers with WHT for this period
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent WHT Transactions */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4 text-purple-500" />
                Recent WHT Transactions ({transactions.length})
              </CardTitle>
              <Link
                href={`/dashboard/tax/transactions?taxType=wht&startDate=${startDate}&endDate=${endDate}`}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                View all <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Doc #</TableHead>
                    <TableHead className="text-xs">Supplier</TableHead>
                    <TableHead className="text-xs text-center">Rate</TableHead>
                    <TableHead className="text-xs text-right">WHT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.slice(0, 10).map((txn) => (
                    <TableRow key={txn._id} className="text-xs">
                      <TableCell className="py-2">
                        {txn.transactionDate?.split("T")[0]}
                      </TableCell>
                      <TableCell className="py-2 font-mono">
                        {txn.sourceDocument?.number || "-"}
                      </TableCell>
                      <TableCell className="py-2 truncate max-w-[120px]">
                        <div>
                          <p>{txn.party?.name || "-"}</p>
                          {txn.party?.taxPin && (
                            <p className="text-muted-foreground text-[10px]">
                              {txn.party.taxPin}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-center">
                        {txn.taxRate}%
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-purple-600 font-medium">
                        {formatCurrency(txn.taxAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {transactions.length > 10 && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  +{transactions.length - 10} more transactions
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">
            WHT Compliance Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" className="flex-1" disabled>
              <FileText className="w-4 h-4 mr-2" />
              Generate Certificates
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleExportCSV}
              disabled={isExporting}
            >
              <Receipt className="w-4 h-4 mr-2" />
              Export for iTax
            </Button>
            <Button
              className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
              disabled
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark as Remitted
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            Remittance and certificate features coming soon
          </p>
        </CardContent>
      </Card>

      {/* iTax Filing Guide */}
      <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-purple-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-purple-900 dark:text-purple-100">
                WHT Remittance Guide
              </p>
              <p className="text-xs text-purple-700 dark:text-purple-300">
                Withholding Tax must be remitted to KRA by the 20th of the
                following month. Use the{" "}
                <a
                  href="https://itax.kra.go.ke"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:no-underline"
                >
                  iTax Portal
                </a>{" "}
                to file returns and issue certificates to suppliers.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
