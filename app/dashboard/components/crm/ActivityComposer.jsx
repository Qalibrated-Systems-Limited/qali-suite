"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logActivity } from "@/app/mongodb/actions/activity-actions";

// Logs an interaction (note/call/email/meeting) against any CRM entity.
// `relatedKind` + `relatedId` are passed as hidden fields so one component
// works on a lead, opportunity, or customer detail page.
const TYPES = ["note", "call", "email", "meeting", "whatsapp"];
const initialState = { success: false, error: null };

const inputCls =
  "rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function ActivityComposer({ relatedKind, relatedId }) {
  const router = useRouter();
  const formRef = useRef(null);
  const [state, formAction, isPending] = useActionState(
    logActivity,
    initialState,
  );

  useEffect(() => {
    if (state.success) {
      toast.success("Logged");
      formRef.current?.reset();
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-2 rounded-md border border-border bg-card p-3"
    >
      <input type="hidden" name="relatedKind" value={relatedKind} />
      <input type="hidden" name="relatedId" value={relatedId} />

      <div className="flex gap-2">
        <select name="type" defaultValue="note" className={inputCls}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          name="subject"
          placeholder="Subject (optional)"
          className={`${inputCls} flex-1`}
        />
      </div>

      <textarea
        name="body"
        rows={2}
        placeholder="What happened? (notes, call summary…)"
        className={`${inputCls} w-full resize-none`}
      />

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Log activity
        </Button>
      </div>
    </form>
  );
}
