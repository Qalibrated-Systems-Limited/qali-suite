"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FileSpreadsheet, Download, X } from "lucide-react";
import { importProgrammeFile } from "@/app/db/actions/programme-actions";
import { toast } from "sonner";

const TEMPLATE =
  "Section,Activity,Start,End,%\n" +
  "Mobilisation,Site establishment,2026-04-01,2026-04-20,100\n" +
  "Earthworks,Clearance — Front 1,2026-04-15,2026-05-31,100\n" +
  "Earthworks,Earthworks — Front 1,2026-05-01,2026-09-30,60\n" +
  "Drainage,Culverts 2500LM,2026-06-01,2026-11-30,20\n";

const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

/**
 * Bulk-import a programme of works from a .csv / .xlsx into the project's WBS.
 * The file is parsed server-side (exceljs) — see importProgrammeFile.
 */
export default function ImportProgramme({ projectId }) {
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
      const res = await importProgrammeFile(projectId, fd);
      if (res?.success) {
        toast.success(res.message);
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
        Import programme
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
                <h3 className="text-lg font-semibold">Import programme</h3>
                <p className="text-sm text-muted-foreground">
                  Upload a .csv or .xlsx with columns:{" "}
                  <span className="font-medium">Section, Activity, Start, End, %</span>.
                </p>
              </div>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close">
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
                href={templateHref}
                download="programme-template.csv"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download template
              </a>
              <span className="text-xs text-muted-foreground">
                Rows become sections &amp; activities.
              </span>
            </div>

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
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Upload className="h-4 w-4 mr-1.5" />}
                Import
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
