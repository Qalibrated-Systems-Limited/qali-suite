"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Printer, FileCheck } from "lucide-react";

/**
 * Key issues / planned-next-month narrative, typed fresh for each report the
 * way the template's MPR generator does — there is no table backing this
 * (Monthly Report composes the other sections' data rather than owning any
 * of its own), so nothing here is saved between visits. Printing uses the
 * browser's own print dialog; "print to PDF" is how every other module in
 * this app produces a document, so this one is not a special case.
 */
export default function ReportNotes() {
  const [issues, setIssues] = useState("");
  const [next, setNext] = useState("");

  return (
    <Card className="p-5 sm:p-6 space-y-4 print:hidden">
      <div className="flex items-center gap-2">
        <FileCheck className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold text-lg">Narrative for this report</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Key issues this month</label>
          <Textarea
            rows={4}
            placeholder="Delays, problems, outstanding instructions..."
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Planned activities next month</label>
          <Textarea
            rows={4}
            placeholder="What will be achieved next month..."
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4 mr-1.5" />
        Print / export as PDF
      </Button>
    </Card>
  );
}
