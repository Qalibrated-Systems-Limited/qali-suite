import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { List } from "lucide-react";
import { getLeaveCalendarEvents } from "@/app/mongodb/queries/hr-queries";
import LeaveCalendarClient from "./LeaveCalendarClient";

export const metadata = { title: "Leave Calendar | HR" };

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Employee"];

async function CalendarLoader({ month, year }) {
  const events = await getLeaveCalendarEvents(month, year);
  return <LeaveCalendarClient events={events} month={month} year={year} />;
}

export default async function LeaveCalendarPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const now = new Date();
  const month = parseInt(params.month || now.getMonth() + 1);
  const year = parseInt(params.year || now.getFullYear());

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Leave Calendar</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">Approved and pending leave at a glance</p>
        </div>
        <Link
          href="/dashboard/hr/leave"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
        >
          <List className="h-4 w-4" />
          <span className="hidden sm:inline">List View</span>
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="h-8 w-48 animate-pulse rounded bg-muted mx-auto" />
            <div className="h-96 animate-pulse rounded-lg bg-muted" />
          </div>
        }
      >
        <CalendarLoader month={month} year={year} />
      </Suspense>
    </div>
  );
}
