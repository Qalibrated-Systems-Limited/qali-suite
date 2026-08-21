import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listLeaveTypesForPage } from "@/app/db/actions/hr-leave-actions";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import { LeaveTypesPage } from "./components/LeaveTypesPage";

export const metadata = { title: "Leave Types | HR" };

// Admin / HR only — matches the server-action guard. Anyone else lands
// back on the HR landing without leaking that this page exists for
// privileged users.
export default async function LeaveTypesIndex() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_ADMIN_ROLES)) redirect("/dashboard/hr");

  let leaveTypes = [];
  let loadError = null;
  try {
    leaveTypes = await listLeaveTypesForPage();
  } catch (err) {
    loadError = err.message;
  }

  return <LeaveTypesPage leaveTypes={leaveTypes} loadError={loadError} />;
}
