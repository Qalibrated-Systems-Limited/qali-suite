import { auth } from "@/auth";
import { redirect } from "next/navigation";

// Role-specific dashboards
import { AdminDashboardPage } from "./components/AdminDashboard";
import EmployeeDashboard from "./components/EmployeeDashborad";
import AccountantDashboard from "./components/AccountantDashboard";
import SuperAdminDashboard from "./components/SuperAdminDashboard";
import HRDashboardPage from "./components/HRDashboard";
import StoreManagerDashboard from "./components/StoreManagerDashboard";

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
  const userRole = (user as { role?: string }).role || "Employee";

  // Route to appropriate dashboard based on role
  switch (userRole) {
    case "SuperAdmin":
      return <SuperAdminDashboard />;

    case "HR":
      return <HRDashboardPage />;

    case "Store Manager":
      return <StoreManagerDashboard />;

    case "Admin":
    case "Manager":
      return <AdminDashboardPage />;

    case "Accountant":
      return <AccountantDashboard />;

    case "Employee":
    case "Technician":
    default:
      return <EmployeeDashboard />;
  }
}
