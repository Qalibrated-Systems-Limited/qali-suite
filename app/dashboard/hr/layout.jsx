import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HRNav from "./components/HRNav";

export default async function HRLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role || "Employee";

  // Plan gating is handled at the individual page and server-action level.
  // The layout only handles auth and renders the nav so that self-service
  // pages (my-leave, my-attendance, my-payslips) are never blocked for
  // Admin/Manager users on plans that don't include the HR module.

  return (
    <div className="flex min-h-screen flex-col">
      <HRNav role={role} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
