import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import LeaveAdminClient from "./LeaveAdminClient";

export const metadata = { title: "Leave Administration | HR" };

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

export default async function LeaveAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard/hr/leave");

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Leave
        </Link>
        <span>/</span>
        <span className="text-foreground">Administration</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Leave Administration</h1>
        <p className="mt-1 text-muted-foreground">
          Run year-end carry-over and monthly accrual. These are batch operations — run once per period.
        </p>
      </div>

      <LeaveAdminClient />
    </div>
  );
}
