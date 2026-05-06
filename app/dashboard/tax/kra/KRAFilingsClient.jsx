"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Receipt,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const TAX_TYPE_LABELS = {
  vat_output: "VAT Output",
  vat_input: "VAT Input",
  wht: "WHT",
  wht_received: "WHT Received",
  paye: "PAYE",
  nssf: "NSSF",
  shif: "SHIF",
  nhif: "NHIF (legacy)",
  housing_levy: "Housing Levy",
  excise_duty: "Excise Duty",
  advance_tax: "Advance Tax",
  dst: "DST",
  turnover_tax: "Turnover Tax",
  cgt: "CGT",
  other: "Other",
};

// Kenya KRA filing deadlines by tax type
const FILING_DEADLINES = {
  vat_output: "20th of following month",
  vat_input: "20th of following month",
  wht: "20th of following month",
  paye: "9th of following month",
  nssf: "15th of following month",
  shif: "9th of following month",
  nhif: "15th of following month",
  housing_levy: "9th of following month",
};

export default function KRAFilingsClient({
  unfiled = [],
  unremittedWHT = [],
  periods = [],
  summary = {},
  initialPeriod,
}) {
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod || "all");
  const [isExporting, setIsExporting] = useState(false);

  const handlePeriodChange = (value) => {
    setSelectedPeriod(value);
    if (value === "all") {
      router.push("/dashboard/tax/kra");
    } else {
      router.push(`/dashboard/tax/kra?period=${value}`);
    }
  };

  const filteredUnfiled = selectedPeriod === "all"
    ? unfiled
    : unfiled.filter((t) => t.kraTracking?.filingPeriod === selectedPeriod);

  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      let csv = "KRA FILING STATUS REPORT\n\n";
      csv += "UNFILED TRANSACTIONS\n";
      csv += "Transaction No,Tax Type,Party,Tax PIN,Amount,Date,Filing Period,Deadline\n";

      filteredUnfiled.forEach((t) => {
        csv += `${t.transactionNumber},${TAX_TYPE_LABELS[t.taxType] || t.taxType},`;
        csv += `"${t.party?.name || ""}",${t.party?.taxPin || ""},`;
        csv += `${t.taxAmount || 0},${formatDate(t.transactionDate)},`;
        csv += `${t.kraTracking?.filingPeriod || ""},${FILING_DEADLINES[t.taxType] || ""}\n`;
      });

      if (unremittedWHT.length > 0) {
        csv += "\nUNREMITTED WHT\n";
        csv += "Transaction No,Supplier,Tax PIN,Amount,Date\n";
        unremittedWHT.forEach((t) => {
          csv += `${t.transactionNumber},"${t.party?.name || ""}",`;
          csv += `${t.party?.taxPin || ""},${t.taxAmount || 0},${formatDate(t.transactionDate)}\n`;
        });
      }

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kra-filings-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Compliance Alert */}
      {filteredUnfiled.length > 0 && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900">
          <CardContent className="p-3 sm:p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                {filteredUnfiled.length} transaction{filteredUnfiled.length !== 1 ? "s" : ""} pending KRA filing
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                File before the deadline to avoid penalties. VAT due by 20th, PAYE by 9th of the following month.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Select value={selectedPeriod} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All periods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All periods</SelectItem>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={isExporting || filteredUnfiled.length === 0}
        >
          <Download className="w-4 h-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Filing Deadlines Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-500" />
            KRA Filing Deadlines
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            {Object.entries(FILING_DEADLINES).map(([type, deadline]) => (
              <div key={type} className="flex items-center gap-2 text-xs sm:text-sm">
                <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">{TAX_TYPE_LABELS[type]}:</span>
                <span className="font-medium">{deadline}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Unfiled Transactions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Unfiled Transactions ({filteredUnfiled.length})
              </CardTitle>
              <Link href="/dashboard/tax/transactions?filed=false">
                <Button variant="ghost" size="sm" className="text-xs">
                  View all <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredUnfiled.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                All transactions filed
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Party</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs hidden sm:table-cell">Period</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnfiled.slice(0, 10).map((t) => (
                      <TableRow key={t._id}>
                        <TableCell className="text-xs">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            {TAX_TYPE_LABELS[t.taxType] || t.taxType}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs truncate max-w-[120px]">
                          {t.party?.name || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium tabular-nums">
                          {formatCurrency(t.taxAmount)}
                        </TableCell>
                        <TableCell className="text-xs hidden sm:table-cell text-muted-foreground">
                          {t.kraTracking?.filingPeriod || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredUnfiled.length > 10 && (
                  <div className="p-2 text-center text-xs text-muted-foreground border-t">
                    +{filteredUnfiled.length - 10} more
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unremitted WHT */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" />
                Unremitted WHT ({unremittedWHT.length})
              </CardTitle>
              <Link href="/dashboard/tax/wht">
                <Button variant="ghost" size="sm" className="text-xs">
                  WHT Reports <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {unremittedWHT.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                All WHT remitted
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Supplier</TableHead>
                      <TableHead className="text-xs">Tax PIN</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs hidden sm:table-cell">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unremittedWHT.slice(0, 10).map((t) => (
                      <TableRow key={t._id}>
                        <TableCell className="text-xs truncate max-w-[120px]">
                          {t.party?.name || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.party?.taxPin || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium tabular-nums">
                          {formatCurrency(t.taxAmount)}
                        </TableCell>
                        <TableCell className="text-xs hidden sm:table-cell text-muted-foreground">
                          {formatDate(t.transactionDate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {unremittedWHT.length > 10 && (
                  <div className="p-2 text-center text-xs text-muted-foreground border-t">
                    +{unremittedWHT.length - 10} more
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <Link href="/dashboard/tax/vat">
              <Button variant="outline" className="w-full justify-start text-xs sm:text-sm h-auto py-3">
                <Receipt className="w-4 h-4 mr-2 text-green-500 shrink-0" />
                <div className="text-left">
                  <p className="font-medium">VAT Returns</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Input/Output & net position</p>
                </div>
              </Button>
            </Link>
            <Link href="/dashboard/tax/wht">
              <Button variant="outline" className="w-full justify-start text-xs sm:text-sm h-auto py-3">
                <FileText className="w-4 h-4 mr-2 text-purple-500 shrink-0" />
                <div className="text-left">
                  <p className="font-medium">WHT Reports</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Withholding & certificates</p>
                </div>
              </Button>
            </Link>
            <Link href="/dashboard/tax/transactions">
              <Button variant="outline" className="w-full justify-start text-xs sm:text-sm h-auto py-3">
                <Receipt className="w-4 h-4 mr-2 text-blue-500 shrink-0" />
                <div className="text-left">
                  <p className="font-medium">All Transactions</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Browse all tax records</p>
                </div>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
