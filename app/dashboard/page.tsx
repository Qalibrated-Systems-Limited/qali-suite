import { auth } from "@/auth";
import { redirect } from "next/navigation";

// Role-specific dashboards
import { AdminDashboardPage } from "./components/AdminDashboard";
import EmployeeDashboard from "./components/EmployeeDashborad";
import AccountantDashboard from "./components/AccountantDashboard";

// ============================================
// MAIN DASHBOARD ROUTER
// ============================================
// Routes users to the appropriate dashboard based on their role

// ============================================

export const metadata = {
  title: "Dashboard | ERP System",
  description: "Your personalized dashboard",
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = user.role || "Employee";

  // Route to appropriate dashboard based on role
  switch (userRole) {
    case "Admin":
    case "Manager":
    case "Store Manager":
      return <AdminDashboardPage />;

    case "Accountant":
      return <AccountantDashboard />;

    case "Employee":
    case "Technician":
    default:
      return <EmployeeDashboard />;
  }
}
