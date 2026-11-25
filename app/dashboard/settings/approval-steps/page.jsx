import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { ArrowLeft, ListChecks } from "lucide-react";
import { getApprovalStepPolicies } from "@/app/db/actions/approval-step-actions";
import ApprovalStepsBoard from "./ApprovalStepsBoard";

export const metadata = { title: "Approval steps | Settings" };
export const dynamic = "force-dynamic";

export default async function ApprovalStepsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "admin.manage")) redirect("/dashboard");
  const data = await getApprovalStepPolicies();
  return (
    <div className="max-w-5xl space-y-6 sm:p-2 lg:p-4">
      <div className="flex items-start gap-3">
        <Link href="/dashboard/settings" className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <ListChecks className="h-6 w-6 text-primary" /> Approval steps
          </h1>
          <p className="text-sm text-muted-foreground">
            Every stock change passes these steps before the stock moves. At each step the approver ticks every line to
            confirm it; one person signs one step, and the person who raised it signs none. Admins may sign any step.
          </p>
        </div>
      </div>
      <ApprovalStepsBoard data={data} />
    </div>
  );
}
