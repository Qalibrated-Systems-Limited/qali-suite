"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FileSpreadsheet, Download, X } from "lucide-react";
import { importBudgetFile } from "@/app/db/actions/budget-import-actions";
import { toast } from "sonner";

const RULES = [
  "One row per budget line. Required columns: Cost Code and Amount.",
  "A cost code you already use is reused; a new one is created against the account beside it.",
  "Account is a GL expense account code or name; leave it blank to use the project's default cost account.",
  "Two rows with the same cost code are added together.",
  "The budget is created as a draft for finance to approve.",
];

/**
 * Upload a project budget from a spreadsheet.
 *
 * The same control as `ImportBoq`, down to the wording — a budget of thirty
 * cost codes is not typed into a web form line by line, and the budget is what
 * every commitment and variance is measured against. Parsed server-side; see
 * `importBudgetFile`, which mints the cost codes the budget references.
 */
export default function ImportBudget({ projectId }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a .csv or .xlsx file first");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await importBudgetFile(projectId, fd);
      if (res?.success) {
        toast.success(res.message);
        if (res.warnings?.length) {
          toast.warning(`${res.warnings.length} row(s) skipped — ${res.warnings[0]}`);
        }
        setOpen(false);
        setFileName("");
        router.refresh();
      } else {
        toast.error(res?.error || "Import failed");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1.5" />
        Upload budget
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
          onClick={() => !isPending && setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Upload budget</h3>
                <p className="text-sm text-muted-foreground">
                  Upload a .csv or .xlsx with columns:{" "}
                  <span className="font-medium">
                    Cost Code, Name, Description, Category, Account, Amount
                  </span>
                  .
                </p>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center hover:bg-muted/50">
              <FileSpreadsheet className="h-7 w-7 text-primary" />
              <span className="text-sm font-medium">
                {fileName || "Click to choose a spreadsheet"}
              </span>
              <span className="text-xs text-muted-foreground">.csv or .xlsx</span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.txt"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
              />
            </label>

            <div className="mt-3 flex items-center justify-between">
              <a
                href="/api/projects/budget/template"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download template
              </a>
              <span className="text-xs text-muted-foreground">
                Rows become a draft budget.
              </span>
            </div>

            <ul className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3">
              {RULES.map((rule) => (
                <li key={rule} className="text-xs text-muted-foreground leading-snug">
                  • {rule}
                </li>
              ))}
            </ul>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={isPending}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Upload
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
