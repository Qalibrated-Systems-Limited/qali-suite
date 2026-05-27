import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAllLeaveTypes } from "@/app/mongodb/actions/leave-type-actions";
import { LeaveTypesPage } from "./components/LeaveTypesPage";

export const metadata = { title: "Leave Types | HR" };

// Admin / HR only — matches the server-action guard. Anyone else lands
// back on the HR landing without leaking that this page exists for
// privileged users.
const ALLOWED = ["SuperAdmin", "Admin", "HR"];

export default async function LeaveTypesIndex() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard/hr");

  const result = await getAllLeaveTypes();
  const leaveTypes = result.success ? result.data : [];

  return (
    <LeaveTypesPage
      leaveTypes={leaveTypes}
      loadError={result.success ? null : result.error}
    />
  );
}
