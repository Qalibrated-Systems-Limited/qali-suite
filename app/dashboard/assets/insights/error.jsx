"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InsightsError({ error, reset }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-700 dark:text-red-400">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold">Could not load fleet insights</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {error?.message || "An unexpected error occurred."}
      </p>
      <Button onClick={() => reset()} variant="outline" className="mt-4">
        <RotateCcw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
