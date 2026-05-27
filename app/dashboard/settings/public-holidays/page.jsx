import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getPublicHolidays } from "@/app/mongodb/queries/hr-queries";
import HolidayClient from "./HolidayClient";

export const metadata = { title: "Public Holidays | Settings" };

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

async function HolidayLoader({ canEdit }) {
  const holidays = await getPublicHolidays();
  return <HolidayClient initialHolidays={holidays} canEdit={canEdit} />;
}

export default async function PublicHolidaysPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard/settings");

  const canEdit = session.user.role === "Admin";

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
          Holidays are excluded from working days calculations in leave requests and payroll periods.
          {!canEdit && " Contact your Admin to make changes."}
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
