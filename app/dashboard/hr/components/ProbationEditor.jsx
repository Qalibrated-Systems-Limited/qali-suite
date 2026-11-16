"use client";

import { useState } from "react";
import { setProbationEnd } from "@/app/db/actions/hr-records-actions";
import { inputClass, Button, useRunAction } from "./records-ui";

/** Set or extend the probation end (s.42: up to twelve months from hire in all). */
export default function ProbationEditor({ employeeId, value }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(value || "");
  const [pending, run] = useRunAction();
  if (!editing) {
    return (
      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditing(true)}>
        {value ? "Change" : "Set"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input type="date" className={`${inputClass()} w-40 py-1`} value={date} onChange={(e) => setDate(e.target.value)} />
      <Button className="px-2 py-1 text-xs" pending={pending} onClick={() => run(() => setProbationEnd(employeeId, date), () => setEditing(false))}>Save</Button>
    </span>
  );
}
