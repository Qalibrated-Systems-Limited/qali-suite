import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { DASHBOARD_FOR_ROLE } from "@/lib/permissions";
import SharedServicesBand from "@/components/shared-services-band";

// Role-specific dashboards
import { AdminDashboardPage } from "./components/AdminDashboard";
import ExecutiveOverview from "./executive/ExecutiveOverview";
import EmployeeDashboard from "./components/EmployeeDashborad";
import AccountantDashboard from "./components/AccountantDashboard";
import SuperAdminDashboard from "./components/SuperAdminDashboard";
import HRDashboardPage from "./components/HRDashboard";
import StoreManagerDashboard from "./components/StoreManagerDashboard";
import CFODashboard from "./components/CFODashboard";
import SalesManagerDashboard from "./components/SalesManagerDashboard";
import StorekeeperDashboard from "./components/StorekeeperDashboard";
import ProcurementDashboard from "./components/ProcurementDashboard";

// ============================================
// MAIN DASHBOARD ROUTER
// ============================================
// Maps every role in the userRoles enum to a concrete dashboard component.
// New roles only need an entry in DASHBOARD_FOR_ROLE (lib/permissions.js)
// and a registry mapping below — no switch statement to keep aligned.

export const metadata = {
  title: "Dashboard | ERP System",
  description: "Your personalized dashboard",
};

const COMPONENT_REGISTRY: Record<string, () => Promise<React.JSX.Element>> = {
  SuperAdminDashboard: async () => <SuperAdminDashboard />,
  AdminDashboard: async () => <AdminDashboardPage />,
  AccountantDashboard: async () => <AccountantDashboard />,
  HRDashboard: async () => <HRDashboardPage />,
  StoreManagerDashboard: async () => <StoreManagerDashboard />,
  CFODashboard: async () => <CFODashboard />,
  SalesManagerDashboard: async () => <SalesManagerDashboard />,
  StorekeeperDashboard: async () => <StorekeeperDashboard />,
  ProcurementDashboard: async () => <ProcurementDashboard />,
  EmployeeDashboard: async () => <EmployeeDashboard />,
  ExecutiveDashboard: async () => <ExecutiveOverview />,
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const userRole =
    (session.user as { role?: string }).role || "Employee";

  const componentName =
    DASHBOARD_FOR_ROLE[userRole as keyof typeof DASHBOARD_FOR_ROLE] ||
    "EmployeeDashboard";

  const render = COMPONENT_REGISTRY[componentName] || COMPONENT_REGISTRY.EmployeeDashboard;
  const dashboard = await render();

  // Shared services ride above every role's dashboard, so the things anyone
  // does regardless of role — requisitions, expenses, leave, tickets, tasks,
  // approvals — are one reach from the landing, whoever just logged in.
  return (
    <>
      <div className="px-4 pt-4 sm:px-5 lg:px-6">
        <SharedServicesBand />
      </div>
      {dashboard}
    </>
  );
}
