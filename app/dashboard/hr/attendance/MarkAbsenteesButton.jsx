"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAbsentees } from "@/app/db/actions/hr-attendance-actions";

/**
 * Marks everybody with no record for the day.
 *
 * Refuses on a weekend or a public holiday, and files somebody on approved
 * leave as ON LEAVE rather than absent — the source does neither, so running
 * it on a Saturday marked the whole company absent, and granted leave showed
 * on the employee's record as an unexplained absence.
 */
export default function MarkAbsenteesButton({ workDate }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAbsentees(workDate);
          if (result.success) {
            toast.success(result.message);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
      <span className="hidden sm:inline">Mark the day</span>
    </Button>
  );
}
