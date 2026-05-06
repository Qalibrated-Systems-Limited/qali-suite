"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bulkImportEmployees } from "@/app/mongodb/actions/hr-import-actions";

// CSV template columns and sample row
const CSV_HEADERS = [
  "firstName","lastName","email","phone",
  "nationalId","kraPin","nssfNumber","shaNumber","gender",
  "department","designation","employmentType","hireDate",
  "basicSalary","paymentMethod","bankName","bankBranch","bankAccount","mpesaNumber",
];

const SAMPLE_ROWS = [
  ["Jane","Doe","jane.doe@company.com","0712345678",
   "12345678","A000000000X","1234567","12345678","female",
   "Finance","Accountant","full_time","2026-01-15",
   "80000","bank","KCB Bank","Westlands","1234567890",""],
  ["John","Kamau","john.kamau@company.com","0723456789",
   "87654321","B000000001Y","","","male",
   "Operations","Driver","full_time","2026-02-01",
   "35000","mpesa","","","","0712000000"],
];

function downloadTemplate() {
  const rows = [CSV_HEADERS, ...SAMPLE_ROWS];
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employee-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    // Simple CSV parse (handles quoted fields)
    const values = [];
    let cur = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { values.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || ""]));
  }).filter((row) => row.firstName || row.lastName);
}

export default function BulkImportClient() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResults(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  function handleImport() {
    if (!rows.length) return;
    startTransition(async () => {
      const result = await bulkImportEmployees(rows);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setResults(result);
      if (result.created > 0) toast.success(`${result.created} employee${result.created > 1 ? "s" : ""} imported`);
      if (result.errors > 0) toast.warning(`${result.errors} row${result.errors > 1 ? "s" : ""} had errors`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Template download */}
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground mb-2">Step 1 — Download the template</p>
        <p className="text-sm text-muted-foreground mb-3">
          Fill in the CSV template. Required columns: <code className="rounded bg-muted px-1 py-0.5 text-xs">firstName</code>, <code className="rounded bg-muted px-1 py-0.5 text-xs">lastName</code>.
          All other columns are optional.
        </p>
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="h-4 w-4" /> Download Template
        </Button>
      </div>

      {/* File upload */}
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground mb-3">Step 2 — Upload your CSV</p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 p-8 text-center hover:bg-muted/40 transition-colors">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {fileName ? <span className="font-medium text-foreground">{fileName}</span> : "Click to choose a CSV file"}
          </span>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">{rows.length} row{rows.length > 1 ? "s" : ""} detected</span>
          )}
          <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </label>
      </div>

      {/* Preview */}
      {rows.length > 0 && !results && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">{rows.length} employee{rows.length > 1 ? "s" : ""} ready to import</p>
            <Button onClick={handleImport} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import Now
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Basic Salary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground">{i + 2}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{row.firstName} {row.lastName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.email || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.department || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.employmentType || "full_time"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.basicSalary ? `KES ${Number(row.basicSalary).toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 10 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">…and {rows.length - 10} more rows</p>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-500/5 p-4 text-center dark:border-emerald-800">
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{results.created}</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Created</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-4 text-center dark:border-amber-800">
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{results.skipped}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">Skipped (duplicate)</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-500/5 p-4 text-center dark:border-red-800">
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">{results.errors}</p>
              <p className="text-xs text-red-700 dark:text-red-400">Errors</p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">Row-by-row results</p>
            </div>
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {results.results.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {r.status === "created" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                  {r.status === "skipped" && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                  {r.status === "error" && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  <span className="text-muted-foreground text-xs shrink-0">Row {r.row}</span>
                  <span className={`flex-1 ${r.status === "error" ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>
                    {r.name || ""} {r.employeeNumber ? `(${r.employeeNumber})` : ""} {r.message || ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
