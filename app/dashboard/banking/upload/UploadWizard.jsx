"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ExcelJS from "exceljs";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileSpreadsheet,
  Check,
  Loader2,
  AlertCircle,
  X,
  Building2,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { importBankStatement } from "@/app/mongodb/actions/bank-feed-actions";

// Supported file types
const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];
const SUPPORTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

// ============================================
// CONSTANTS
// ============================================
const STEPS = [
  { id: 1, name: "Upload File", description: "Select file and bank account" },
  { id: 2, name: "Map Columns", description: "Match columns to fields" },
  { id: 3, name: "Preview & Import", description: "Review and confirm" },
];

const DATE_FORMATS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (e.g., 25/01/2024)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (e.g., 01/25/2024)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g., 2024-01-25)" },
  { value: "DD-MM-YYYY", label: "DD-MM-YYYY (e.g., 25-01-2024)" },
  { value: "DD.MM.YYYY", label: "DD.MM.YYYY (e.g., 25.01.2024)" },
];

const REQUIRED_FIELDS = ["date", "description"];

// Keywords to detect header rows (case-insensitive). Split into "strong"
// signals — a real bank-statement header almost always has BOTH a date-like
// column AND an amount-like column. We use this to disambiguate against
// preamble rows that incidentally match a couple of generic words.
const DATE_KEYWORDS = ["date", "posting", "value date", "txn date", "tran date"];
const AMOUNT_KEYWORDS = [
  "amount",
  "debit",
  "credit",
  "money in",
  "money out",
  "withdrawal",
  "deposit",
  "dr amount",
  "cr amount",
  "paid in",
  "paid out",
];
const HEADER_KEYWORDS = [
  ...DATE_KEYWORDS,
  ...AMOUNT_KEYWORDS,
  "transaction",
  "description",
  "narration",
  "narrative",
  "details",
  "particulars",
  "balance",
  "reference",
  "ref",
  "cheque",
  "check",
  "type",
  "tran",
  "txn",
  "branch",
];

// Auto-mapping rules: column name patterns -> field keys
// Order matters - more specific patterns should come first
const AUTO_MAP_RULES = [
  { patterns: ["transaction date", "trans date", "posting date", "value date", "txn date", "tran date", "date"], field: "date" },
  { patterns: ["description", "narration", "narrative", "details", "particulars", "transaction details", "remarks"], field: "description" },
  { patterns: ["bank reference", "reference number", "ref no", "cheque no", "check no", "txn id", "transaction id", "reference", "ref"], field: "reference" },
  // "dr"/"cr" alone are dangerous as substrings (would match "Currency")
  // — handled below as exact-only matches in autoMapColumns().
  { patterns: ["money out", "debit", "withdrawal", "paid out", "outflow", "dr amount"], field: "debit" },
  { patterns: ["money in", "credit", "deposit", "paid in", "inflow", "cr amount"], field: "credit" },
  { patterns: ["ledger balance", "running balance", "available balance", "closing balance", "balance"], field: "balance" },
  // Amount should be last and only match exact "amount" to avoid false positives
  { patterns: ["amount", "transaction amount", "txn amount", "tran amount"], field: "amount" },
];

/**
 * Find the actual header row in data that may have title/summary/preamble rows.
 *
 * Rather than returning the FIRST row that hits a fixed match threshold —
 * which mis-fires on preambles like "Statement of account for ..." that
 * happen to contain words like "account" or "balance" — score every row in
 * the first 50 and return the best one. A real bank-statement header
 * essentially always has BOTH a date-like column AND an amount-like column,
 * so we treat that pair as the strong signal.
 */
function findHeaderRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  let bestIndex = -1;
  let bestScore = 0;
  const scanLimit = Math.min(rows.length, 50);

  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 2) continue;

    // Stringify each cell once.
    const cells = [];
    for (let c = 0; c < row.length; c++) {
      cells.push(String(row[c] || "").toLowerCase().trim());
    }

    let totalMatches = 0;
    let hasDate = false;
    let hasAmount = false;
    let nonEmptyCells = 0;

    for (const cellStr of cells) {
      if (!cellStr) continue;
      nonEmptyCells++;
      let matched = false;
      for (const kw of DATE_KEYWORDS) {
        if (cellStr.includes(kw)) {
          hasDate = true;
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (const kw of AMOUNT_KEYWORDS) {
          if (cellStr.includes(kw)) {
            hasAmount = true;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        for (const kw of HEADER_KEYWORDS) {
          if (cellStr.includes(kw)) {
            matched = true;
            break;
          }
        }
      }
      if (matched) totalMatches++;
    }

    // Score: total keyword matches, with a big bonus for the strong
    // (date + amount) pair. Prefer rows with more non-empty cells too —
    // a single-cell preamble that matches "balance" shouldn't outrank a
    // proper multi-column header.
    let score = totalMatches;
    if (hasDate && hasAmount) score += 100;
    else if (hasDate || hasAmount) score += 5;
    score += Math.min(nonEmptyCells, 10) * 0.1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  // Require at least the (date OR amount) signal AND ≥ 2 keyword matches.
  // Otherwise fall back to row 0 — the user can correct via the manual
  // header-row dropdown.
  if (bestIndex >= 0 && bestScore >= 2) return bestIndex;
  return 0;
}

/**
 * Auto-suggest column mappings based on header names
 * Uses scoring to find best matches
 */
function autoMapColumns(headers) {
  const mapping = {};
  const usedHeaders = new Set();

  // Score each header against each field
  const scores = [];

  for (const header of headers) {
    const headerLower = String(header || "").toLowerCase().trim();
    if (!headerLower) continue;

    for (const rule of AUTO_MAP_RULES) {
      for (const pattern of rule.patterns) {
        let score = 0;

        // Exact match gets highest score
        if (headerLower === pattern) {
          score = 100;
        }
        // Header contains full pattern
        else if (headerLower.includes(pattern)) {
          score = 50 + pattern.length; // Longer patterns score higher
        }
        // Pattern contains header (less reliable)
        else if (pattern.includes(headerLower) && headerLower.length > 3) {
          score = 20;
        }

        if (score > 0) {
          scores.push({ header, field: rule.field, score, pattern });
        }
      }
    }

    // Special-case: "DR" / "CR" / "D" / "C" alone are common single-letter
    // debit/credit indicators on Kenyan bank exports — but matching them
    // as substrings would also match "Currency", "Description", etc. So
    // only honour them as EXACT header matches.
    if (headerLower === "dr" || headerLower === "d") {
      scores.push({ header, field: "debit", score: 100, pattern: "dr-exact" });
    } else if (headerLower === "cr" || headerLower === "c") {
      scores.push({ header, field: "credit", score: 100, pattern: "cr-exact" });
    }
  }

  // Sort by score descending and assign mappings
  scores.sort((a, b) => b.score - a.score);

  for (const { header, field } of scores) {
    // Skip if field already mapped or header already used
    if (mapping[field] || usedHeaders.has(header)) continue;

    mapping[field] = header;
    usedHeaders.add(header);
  }

  return mapping;
}

// ============================================
// TEMPLATE DOWNLOAD
// ============================================
/**
 * Generate and download a sample bank-statement Excel file. Column names
 * match the auto-mapping rules so users can paste their bank's data into
 * the same shape and the wizard's auto-detection will pick everything up
 * on first try. Two sample rows demonstrate the expected format
 * (one debit, one credit, with running balance).
 */
async function downloadBankFeedTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bank Statement");

  sheet.columns = [
    { header: "Transaction Date", key: "date", width: 18 },
    { header: "Description", key: "description", width: 40 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Money Out", key: "debit", width: 14 },
    { header: "Money In", key: "credit", width: 14 },
    { header: "Balance", key: "balance", width: 16 },
  ];

  // Sample rows — DD/MM/YYYY date format (the wizard's default).
  sheet.addRow({
    date: "01/02/2026",
    description: "Office rent — Feb",
    reference: "RENT-FEB",
    debit: 50000,
    credit: "",
    balance: 350000,
  });
  sheet.addRow({
    date: "03/02/2026",
    description: "Customer payment — INV-2025-0042",
    reference: "MPESA-RKL2X9",
    debit: "",
    credit: 120000,
    balance: 470000,
  });
  sheet.addRow({
    date: "05/02/2026",
    description: "Bank charges",
    reference: "FEE-0205",
    debit: 250,
    credit: "",
    balance: 469750,
  });

  // Bold the header row so it's obvious to the user where their data goes.
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  // Number format for amount columns — KES, no currency symbol so it
  // imports cleanly back into the wizard.
  ["D", "E", "F"].forEach((col) => {
    sheet.getColumn(col).numFmt = "#,##0.00;-#,##0.00";
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bank-statement-template.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Detect date format from sample values
 */
function detectDateFormat(sampleValues) {
  for (const value of sampleValues) {
    const str = String(value || "").trim();
    if (!str) continue;

    // DD.MM.YYYY (e.g., 01.02.2026)
    if (/^\s*\d{1,2}\.\d{1,2}\.\d{4}/.test(str)) return "DD.MM.YYYY";
    // DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return "DD/MM/YYYY";
    // YYYY-MM-DD
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) return "YYYY-MM-DD";
    // DD-MM-YYYY
    if (/^\d{1,2}-\d{1,2}-\d{4}/.test(str)) return "DD-MM-YYYY";
    // MM/DD/YYYY (harder to detect, assume DD/MM/YYYY by default)
  }
  return "DD/MM/YYYY";
}

// ============================================
// STEP INDICATOR
// ============================================
function StepIndicator({ currentStep }) {
  return (
    <nav className="mb-8">
      <ol className="flex items-center justify-center gap-2 sm:gap-4">
        {STEPS.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isCompleted = step.id < currentStep;

          return (
            <li key={step.id} className="flex items-center">
              <div className="flex items-center">
                <div
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium
                    ${
                      isCompleted
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }
                  `}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : step.id}
                </div>
                <div className="ml-2 hidden sm:block">
                  <p
                    className={`text-sm font-medium ${
                      isCurrent ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {step.name}
                  </p>
                </div>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 w-8 sm:w-16 ${
                    isCompleted ? "bg-emerald-500" : "bg-muted"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ============================================
// STEP 1: FILE UPLOAD
// ============================================
function FileUploadStep({ data, setData, bankAccounts, onNext }) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const processFile = useCallback((file) => {
    setError("");

    if (!file) return;

    // Validate file type
    const fileName = file.name.toLowerCase();
    const isValidExtension = SUPPORTED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    const isValidMimeType = SUPPORTED_MIME_TYPES.includes(file.type);

    if (!isValidExtension && !isValidMimeType) {
      setError("Please upload a CSV or Excel file (.csv, .xlsx, .xls)");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError("File size must be less than 5MB");
      return;
    }

    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    if (isExcel) {
      // Handle Excel file we 
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(e.target.result);

          // Get the first sheet
          const worksheet = workbook.worksheets[0];

          // Convert to array of arrays. ExcelJS returns `row.values` as a
          // 1-indexed sparse array (leading empty cells are HOLES). Build a
          // dense, defensively-typed string array per row so downstream
          // `.map` / `.filter` / `.length` checks don't trip on holes or on
          // hyperlink/formula/richText cell objects.
          const cellToValue = (cell) => {
            if (cell == null) return "";
            if (typeof cell !== "object") return cell;
            // Date stays a Date — date-format detection needs raw values.
            if (cell instanceof Date) return cell;
            // Formula cell: { formula, result }
            if (cell.result !== undefined) return cell.result == null ? "" : cell.result;
            // Rich text: { richText: [{ text }, ...] }
            if (Array.isArray(cell.richText)) {
              return cell.richText.map((t) => t.text || "").join("");
            }
            // Hyperlink cell: { text, hyperlink }
            if (cell.text !== undefined) return cell.text;
            // Shared string / inline string variants
            if (cell.value !== undefined) return cell.value;
            return "";
          };

          const jsonData = [];
          let widest = 0;
          worksheet.eachRow({ includeEmpty: true }, (row) => {
            const rawValues = Array.isArray(row.values) ? row.values : [];
            const dense = [];
            // 1-indexed: skip slot 0; iterate up to length, push for each
            // column position so holes become "".
            for (let c = 1; c < rawValues.length; c++) {
              dense.push(cellToValue(rawValues[c]));
            }
            if (dense.length > widest) widest = dense.length;
            jsonData.push(dense);
          });

          // Pad every row to the widest column count so column positions
          // line up across the file.
          for (const row of jsonData) {
            while (row.length < widest) row.push("");
          }

          // Filter out completely empty rows
          const allRows = jsonData.filter((row) =>
            row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")
          );

          if (allRows.length < 2) {
            setError("File must have at least a header row and one data row");
            return;
          }

          // Auto-detect the header row (skip title/summary rows)
          const headerRowIndex = findHeaderRow(allRows);
          const headers = allRows[headerRowIndex].map((h) => String(h || "").trim());

          // Data rows start after header
          const dataRows = allRows.slice(headerRowIndex + 1);
          const previewRows = dataRows.slice(0, 5).map((row) =>
            row.map((cell) => String(cell || "").trim())
          );

          if (dataRows.length === 0) {
            setError("No data rows found after the header row");
            return;
          }

          // Auto-suggest column mappings
          const suggestedMapping = autoMapColumns(headers);

          // Auto-detect date format from sample data
          const dateColIndex = headers.findIndex((h) =>
            h.toLowerCase().includes("date")
          );
          const sampleDates = dateColIndex >= 0
            ? dataRows.slice(0, 5).map((row) => row[dateColIndex])
            : [];
          const detectedDateFormat = detectDateFormat(sampleDates);

          // Convert Excel data to CSV format for backend (only data from header row onwards)
          const rowsForCSV = allRows.slice(headerRowIndex);
          const csvContent = rowsForCSV.map((row) =>
            row.map((cell) => {
              const cellStr = String(cell || "");
              if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
                return `"${cellStr.replace(/"/g, '""')}"`;
              }
              return cellStr;
            }).join(",")
          ).join("\n");

          setData((prev) => ({
            ...prev,
            file,
            fileName: file.name,
            csvContent,
            headers,
            previewRows,
            totalRows: dataRows.length,
            headerRowIndex,
            allRows, // Keep all rows for header row selector
            columnMapping: suggestedMapping,
            dateFormat: detectedDateFormat,
          }));
        } catch (err) {
          console.error("Excel parsing error:", err);
          setError("Error reading Excel file. Please ensure it's a valid spreadsheet.");
        }
      };

      reader.onerror = () => {
        setError("Error reading file");
      };

      reader.readAsArrayBuffer(file);
    } else {
      // Handle CSV file
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        const lines = content.split("\n").filter((l) => l.trim());

        if (lines.length < 2) {
          setError("CSV must have at least a header row and one data row");
          return;
        }

        // Parse all rows
        const allRows = lines.map((line) => parseCSVLine(line));

        // Auto-detect the header row
        const headerRowIndex = findHeaderRow(allRows);
        const headers = allRows[headerRowIndex];

        // Data rows start after header
        const dataRows = allRows.slice(headerRowIndex + 1);
        const previewRows = dataRows.slice(0, 5);

        if (dataRows.length === 0) {
          setError("No data rows found after the header row");
          return;
        }

        // Auto-suggest column mappings
        const suggestedMapping = autoMapColumns(headers);

        // Auto-detect date format
        const dateColIndex = headers.findIndex((h) =>
          h.toLowerCase().includes("date")
        );
        const sampleDates = dateColIndex >= 0
          ? dataRows.slice(0, 5).map((row) => row[dateColIndex])
          : [];
        const detectedDateFormat = detectDateFormat(sampleDates);

        // Only include data from header row onwards for backend
        const csvContent = lines.slice(headerRowIndex).join("\n");

        setData((prev) => ({
          ...prev,
          file,
          fileName: file.name,
          csvContent,
          headers,
          previewRows,
          totalRows: dataRows.length,
          headerRowIndex,
          allRows,
          columnMapping: suggestedMapping,
          dateFormat: detectedDateFormat,
        }));
      };

      reader.onerror = () => {
        setError("Error reading file");
      };

      reader.readAsText(file);
    }
  }, [setData]);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processFile(e.dataTransfer.files[0]);
      }
    },
    [processFile]
  );

  const handleFileInput = useCallback(
    (e) => {
      if (e.target.files && e.target.files[0]) {
        processFile(e.target.files[0]);
      }
    },
    [processFile]
  );

  const canProceed = data.file && data.bankAccountId;

  return (
    <div className="space-y-6">
      {/* Bank Account Selection */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Bank Account <span className="text-red-500">*</span>
        </label>
        <select
          value={data.bankAccountId || ""}
          onChange={(e) =>
            setData((prev) => ({ ...prev, bankAccountId: e.target.value }))
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select bank account...</option>
          {bankAccounts.map((account) => (
            <option key={account._id} value={account._id}>
              {account.accountCode} - {account.accountName}
            </option>
          ))}
        </select>
        {bankAccounts.length === 0 && (
          <p className="text-sm text-amber-600 mt-1">
            No bank accounts found. Please create a bank account first.
          </p>
        )}
      </div>

      {/* File Upload */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="block text-sm font-medium">
            Bank Statement File <span className="text-red-500">*</span>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadBankFeedTemplate}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Download template
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Don&apos;t have a bank-export file handy? Download the template,
          paste your transactions in, and upload it back — the wizard will
          auto-detect every column.
        </p>
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`
            relative rounded-lg border-2 border-dashed p-8 text-center transition-colors
            ${
              dragActive
                ? "border-primary bg-primary/5"
                : data.file
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }
          `}
        >
          {data.file ? (
            <div className="space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="font-medium">{data.fileName}</p>
              <p className="text-sm text-muted-foreground">
                {data.totalRows} rows found
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setData((prev) => ({
                    ...prev,
                    file: null,
                    fileName: "",
                    csvContent: "",
                    headers: [],
                    previewRows: [],
                    totalRows: 0,
                  }))
                }
              >
                <X className="h-4 w-4 mr-1" />
                Remove
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium">Drop your file here</p>
              <p className="text-sm text-muted-foreground">CSV or Excel (.csv, .xlsx, .xls)</p>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={handleFileInput}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-500 mt-2 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        )}
      </div>

      {/* File Preview */}
      {data.headers.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Detected Columns
          </label>
          <div className="flex flex-wrap gap-2">
            {data.headers.map((header, index) => (
              <span
                key={index}
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-muted"
              >
                {header || `Column ${index + 1}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" asChild>
          <Link href="/dashboard/banking">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Cancel
          </Link>
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Continue
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

// ============================================
// STEP 2: COLUMN MAPPING
// ============================================
function ColumnMappingStep({ data, setData, onBack, onNext }) {
  const [error, setError] = useState("");

  // Determine which amount mode is being used
  const mapping = data.columnMapping || {};
  const hasSeparateColumns = mapping.debit || mapping.credit;
  const hasSingleAmount = mapping.amount;

  const handleMappingChange = (field, value) => {
    const newMapping = { ...data.columnMapping, [field]: value };

    // If setting debit or credit, clear amount (and vice versa)
    if ((field === "debit" || field === "credit") && value) {
      delete newMapping.amount;
    } else if (field === "amount" && value) {
      delete newMapping.debit;
      delete newMapping.credit;
    }

    setData((prev) => ({
      ...prev,
      columnMapping: newMapping,
    }));
    setError("");
  };

  const handleHeaderRowChange = (newIndex) => {
    const allRows = data.allRows;
    if (!allRows || newIndex >= allRows.length) return;

    const headers = allRows[newIndex].map((h) => String(h || "").trim());
    const dataRows = allRows.slice(newIndex + 1);
    const previewRows = dataRows.slice(0, 5).map((row) =>
      row.map((cell) => String(cell || "").trim())
    );

    // Re-suggest mappings for new headers
    const suggestedMapping = autoMapColumns(headers);

    // Rebuild CSV content
    const rowsForCSV = allRows.slice(newIndex);
    const csvContent = rowsForCSV.map((row) =>
      row.map((cell) => {
        const cellStr = String(cell || "");
        if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(",")
    ).join("\n");

    setData((prev) => ({
      ...prev,
      headerRowIndex: newIndex,
      headers,
      previewRows,
      totalRows: dataRows.length,
      csvContent,
      columnMapping: suggestedMapping,
    }));
  };

  const validateMapping = () => {
    const currentMapping = data.columnMapping || {};

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (!currentMapping[field]) {
        setError(`Please map the "${field}" column`);
        return false;
      }
    }

    // Check that either debit/credit OR amount is mapped
    const hasDebit = currentMapping.debit;
    const hasCredit = currentMapping.credit;
    const hasAmount = currentMapping.amount;

    if (!hasDebit && !hasCredit && !hasAmount) {
      setError(
        "Please map your amount columns. Either:\n" +
        "• Map both 'Debit' and 'Credit' (or just one if your file only has one)\n" +
        "• Or map a single 'Amount' column if your bank uses +/- signs"
      );
      return false;
    }

    return true;
  };

  const handleNext = () => {
    if (validateMapping()) {
      onNext();
    }
  };

  // Count auto-mapped fields
  const autoMappedCount = Object.values(data.columnMapping || {}).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Auto-detection info */}
      {autoMappedCount > 0 && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-4 text-emerald-800 dark:text-emerald-200 text-sm">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5" />
            <span className="font-medium">
              Auto-detected {autoMappedCount} column{autoMappedCount > 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-1 text-emerald-700 dark:text-emerald-300">
            Review and adjust the mappings below if needed.
          </p>
        </div>
      )}

      {/* Header Row Selector */}
      {data.allRows && data.allRows.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Header Row
            <span className="font-normal text-muted-foreground ml-2">
              (Row {(data.headerRowIndex || 0) + 1} detected)
            </span>
          </label>
          <select
            value={data.headerRowIndex || 0}
            onChange={(e) => handleHeaderRowChange(parseInt(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {data.allRows.slice(0, 20).map((row, index) => {
              const preview = row.slice(0, 4).map((c) => String(c || "").substring(0, 15)).join(" | ");
              return (
                <option key={index} value={index}>
                  Row {index + 1}: {preview}{row.length > 4 ? "..." : ""}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Date Format */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Date Format
          {data.dateFormat && (
            <span className="font-normal text-muted-foreground ml-2">
              (auto-detected)
            </span>
          )}
        </label>
        <select
          value={data.dateFormat || "DD/MM/YYYY"}
          onChange={(e) =>
            setData((prev) => ({ ...prev, dateFormat: e.target.value }))
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {DATE_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
      </div>

      {/* Required Fields */}
      <div>
        <label className="block text-sm font-medium mb-3">
          Required Fields
        </label>
        <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
          {/* Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
            <div>
              <span className="font-medium text-sm">
                Date <span className="text-red-500">*</span>
              </span>
              <p className="text-xs text-muted-foreground">Transaction date</p>
            </div>
            <select
              value={mapping.date || ""}
              onChange={(e) => handleMappingChange("date", e.target.value)}
              className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                mapping.date ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
              }`}
            >
              <option value="">-- Select column --</option>
              {data.headers.map((header, index) => (
                <option key={index} value={header}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
            <div>
              <span className="font-medium text-sm">
                Description <span className="text-red-500">*</span>
              </span>
              <p className="text-xs text-muted-foreground">Transaction details/narration</p>
            </div>
            <select
              value={mapping.description || ""}
              onChange={(e) => handleMappingChange("description", e.target.value)}
              className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                mapping.description ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
              }`}
            >
              <option value="">-- Select column --</option>
              {data.headers.map((header, index) => (
                <option key={index} value={header}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Amount Columns - with explanation */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Amount Columns <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-muted-foreground mb-3">
          Choose ONE option based on your bank statement format:
        </p>

        <div className="space-y-4">
          {/* Option 1: Separate Debit/Credit */}
          <div className={`rounded-lg border p-4 ${hasSeparateColumns ? "border-primary bg-primary/5" : "bg-muted/30"}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-4 w-4 rounded-full border-2 ${hasSeparateColumns ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                {hasSeparateColumns && <Check className="h-3 w-3 text-white" />}
              </div>
              <span className="font-medium text-sm">Option 1: Separate columns</span>
              <span className="text-xs text-muted-foreground">(Money Out / Money In)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Debit / Money Out</label>
                <select
                  value={mapping.debit || ""}
                  onChange={(e) => handleMappingChange("debit", e.target.value)}
                  className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                    mapping.debit ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
                  }`}
                >
                  <option value="">-- Not mapped --</option>
                  {data.headers.map((header, index) => (
                    <option key={index} value={header}>
                      {header || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Credit / Money In</label>
                <select
                  value={mapping.credit || ""}
                  onChange={(e) => handleMappingChange("credit", e.target.value)}
                  className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                    mapping.credit ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
                  }`}
                >
                  <option value="">-- Not mapped --</option>
                  {data.headers.map((header, index) => (
                    <option key={index} value={header}>
                      {header || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Option 2: Single Amount */}
          <div className={`rounded-lg border p-4 ${hasSingleAmount ? "border-primary bg-primary/5" : "bg-muted/30"}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-4 w-4 rounded-full border-2 ${hasSingleAmount ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                {hasSingleAmount && <Check className="h-3 w-3 text-white" />}
              </div>
              <span className="font-medium text-sm">Option 2: Single amount column</span>
              <span className="text-xs text-muted-foreground">(uses +/- signs)</span>
            </div>
            <select
              value={mapping.amount || ""}
              onChange={(e) => handleMappingChange("amount", e.target.value)}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                mapping.amount ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
              }`}
            >
              <option value="">-- Not mapped --</option>
              {data.headers.map((header, index) => (
                <option key={index} value={header}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Optional Fields */}
      <div>
        <label className="block text-sm font-medium mb-3">
          Optional Fields
        </label>
        <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
          {/* Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
            <div>
              <span className="font-medium text-sm">Reference</span>
              <p className="text-xs text-muted-foreground">Check number, transaction ref</p>
            </div>
            <select
              value={mapping.reference || ""}
              onChange={(e) => handleMappingChange("reference", e.target.value)}
              className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                mapping.reference ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
              }`}
            >
              <option value="">-- Not mapped --</option>
              {data.headers.map((header, index) => (
                <option key={index} value={header}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          {/* Balance */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
            <div>
              <span className="font-medium text-sm">Balance</span>
              <p className="text-xs text-muted-foreground">Running/ledger balance</p>
            </div>
            <select
              value={mapping.balance || ""}
              onChange={(e) => handleMappingChange("balance", e.target.value)}
              className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                mapping.balance ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-input bg-background"
              }`}
            >
              <option value="">-- Not mapped --</option>
              {data.headers.map((header, index) => (
                <option key={index} value={header}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {/* Preview Table */}
      {data.previewRows.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Data Preview
            <span className="font-normal text-muted-foreground ml-2">
              ({data.totalRows} rows)
            </span>
          </label>
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  {data.headers.map((header, index) => (
                    <th
                      key={index}
                      className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {header || `Col ${index + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.previewRows.slice(0, 3).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-3 py-2 whitespace-nowrap max-w-50 truncate"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button onClick={handleNext}>
          Continue
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

// ============================================
// STEP 3: PREVIEW & IMPORT
// ============================================
function PreviewImportStep({ data, bankAccounts, onBack }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  const selectedAccount = bankAccounts.find((a) => a._id === data.bankAccountId);

  const handleImport = async () => {
    setImporting(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("bankAccountId", data.bankAccountId);
      formData.append("fileName", data.fileName);
      formData.append("csvContent", data.csvContent);
      formData.append("columnMapping", JSON.stringify(data.columnMapping));
      formData.append("dateFormat", data.dateFormat || "DD/MM/YYYY");

      const result = await importBankStatement(formData);

      if (result.success) {
        setSuccess(result);
        // Redirect to statement page after short delay
        setTimeout(() => {
          router.push(`/dashboard/banking/${result.statementId}`);
        }, 2000);
      } else {
        setError(result.error || "Failed to import statement");
      }
    } catch (err) {
      setError(err.message || "An error occurred during import");
    } finally {
      setImporting(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-emerald-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Import Successful!</h2>
        <p className="text-muted-foreground mb-4">
          {success.linesImported} transactions imported successfully.
        </p>
        <p className="text-sm text-muted-foreground">
          Redirecting to allocation page...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold mb-4">Import Summary</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">File Name</span>
            <span className="font-medium">{data.fileName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bank Account</span>
            <span className="font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {selectedAccount?.accountCode} - {selectedAccount?.accountName}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Rows</span>
            <span className="font-medium">{data.totalRows}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date Format</span>
            <span className="font-medium">{data.dateFormat || "DD/MM/YYYY"}</span>
          </div>
        </div>
      </div>

      {/* Column Mapping Summary */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold mb-4">Column Mapping</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {Object.entries(data.columnMapping || {}).map(
            ([field, column]) =>
              column && (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-muted-foreground capitalize">{field}:</span>
                  <span className="font-medium">{column}</span>
                </div>
              )
          )}
        </div>
      </div>

      {/* Preview Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted/50 px-4 py-2 border-b">
          <h3 className="font-medium text-sm">Data Preview (First 5 rows)</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium">Reference</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th>
                <th className="px-3 py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.previewRows.map((row, index) => {
                const mapping = data.columnMapping || {};
                const headers = data.headers;

                const getValue = (field) => {
                  const colName = mapping[field];
                  if (!colName) return "-";
                  const colIndex = headers.indexOf(colName);
                  return colIndex >= 0 ? row[colIndex] || "-" : "-";
                };

                return (
                  <tr key={index}>
                    <td className="px-3 py-2">{getValue("date")}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate">
                      {getValue("description")}
                    </td>
                    <td className="px-3 py-2">{getValue("reference")}</td>
                    <td className="px-3 py-2 text-right">
                      {mapping.amount ? getValue("amount") : getValue("debit")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {mapping.amount ? "-" : getValue("credit")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Warning */}
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-4 text-amber-800 dark:text-amber-200 text-sm">
        <p className="font-medium mb-1">Before importing:</p>
        <ul className="list-disc list-inside space-y-1 text-amber-700 dark:text-amber-300">
          <li>Verify the column mapping is correct</li>
          <li>Check that the date format matches your bank statement</li>
          <li>Duplicate transactions will be automatically skipped</li>
        </ul>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack} disabled={importing}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button onClick={handleImport} disabled={importing}>
          {importing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Import Statement
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// HELPER: Parse CSV Line
// ============================================
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// ============================================
// MAIN WIZARD COMPONENT
// ============================================
export default function UploadWizard({ bankAccounts }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    file: null,
    fileName: "",
    csvContent: "",
    headers: [],
    previewRows: [],
    totalRows: 0,
    bankAccountId: "",
    columnMapping: {},
    dateFormat: "DD/MM/YYYY",
  });

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Import Bank Statement
        </h1>
        <p className="text-muted-foreground">
          Upload a CSV or Excel file from your bank and map the columns
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={step} />

      {/* Step Content */}
      <div className="rounded-lg border bg-card p-6">
        {step === 1 && (
          <FileUploadStep
            data={data}
            setData={setData}
            bankAccounts={bankAccounts}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <ColumnMappingStep
            data={data}
            setData={setData}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <PreviewImportStep
            data={data}
            bankAccounts={bankAccounts}
            onBack={() => setStep(2)}
          />
        )}
      </div>
    </div>
  );
}
