import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listHolidaysForPage } from "@/app/db/actions/hr-leave-actions";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import HolidayClient from "./HolidayClient";

export const metadata = { title: "Public Holidays | Settings" };

async function HolidayLoader({ canEdit }) {
  const holidays = await listHolidaysForPage();
  return <HolidayClient initialHolidays={holidays} canEdit={canEdit} />;
}

export default async function PublicHolidaysPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_ADMIN_ROLES)) redirect("/dashboard/settings");

  // Whoever may open this page may edit it. The source let HR see the calendar
  // and then told them to ask an Admin, while the ACTION has always accepted
  // HR Manager.
  const canEdit = true;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/settings" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Public Holidays</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Public Holidays</h1>
        <p className="mt-1 text-muted-foreground">
          Excluded from the working-day count everywhere: leave requests,
          payroll pro-rata, and the attendance roster. A holiday that recurs
          takes no year; a one-off needs one, or nothing will ever match it.
        </p>
      </div>

      <Suspense fallback={
        <div className="space-y-2">
          {[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg border border-border bg-muted/30 animate-pulse" />)}
        </div>
      }>
        <HolidayLoader canEdit={canEdit} />
      </Suspense>
    </div>
  );
}
