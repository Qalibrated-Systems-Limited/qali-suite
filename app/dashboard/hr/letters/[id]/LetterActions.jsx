"use client";

import { useState } from "react";
import { voidHrLetter } from "@/app/db/actions/hr-records-actions";
import { Button, useRunAction, inputClass } from "../../components/records-ui";

export default function LetterActions({ id }) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        Void letter
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${inputClass()} max-w-xs`} placeholder="Why is it being voided?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button variant="danger" pending={pending} disabled={!reason.trim()} onClick={() => run(() => voidHrLetter(id, reason))}>
        Confirm void
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
