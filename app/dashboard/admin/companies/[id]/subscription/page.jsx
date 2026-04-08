import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { getSubscriptionAuditLog } from "@/app/mongodb/actions/subscription-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Building2, Shield } from "lucide-react";
import { PLAN_LIMITS } from "@/lib/plans";
import SubscriptionForms from "./SubscriptionForms";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const company = await getCompanyById(id);
  return {
    title: `Subscription - ${company?.name || "Company"}`,
  };
}

const statusColors = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  trial: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  expired: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  cancelled: "bg-red-500/10 text-red-600 border-red-500/20",
};

const planColors = {
  free: "bg-gray-500/10 text-gray-600",
  starter: "bg-blue-500/10 text-blue-600",
  professional: "bg-purple-500/10 text-purple-600",
  enterprise: "bg-yellow-500/10 text-yellow-600",
};

const actionLabels = {
  plan_changed: "Plan Changed",
  status_changed: "Status Changed",
  trial_started: "Trial Started",
  trial_extended: "Trial Extended",
  max_users_changed: "Max Users Changed",
  renewed: "Renewed",
  auto_expired: "Auto-Expired",
};

export default async function SubscriptionPage({ params }) {
  const session = await auth();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "SuperAdmin") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-destructive">Not Authorized</h1>
          <p className="text-muted-foreground mt-2">
            Only SuperAdmin can manage subscriptions.
          </p>
        </div>
      </div>
    );
  }

  const { id } = await params;
  const company = await getCompanyById(id);

  if (!company) {
    notFound();
  }

  const auditLogs = await getSubscriptionAuditLog(id);

  const companyData = JSON.parse(JSON.stringify(company));

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Back Button */}
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/dashboard/admin/companies/${id}`}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Company
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-yellow-500/10 rounded-lg">
            <Shield className="h-8 w-8 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Subscription Management</h1>
            <p className="text-muted-foreground">{companyData.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusColors[companyData.subscription?.status]}>
            {companyData.subscription?.status}
          </Badge>
          <Badge variant="outline" className={planColors[companyData.subscription?.plan]}>
            {companyData.subscription?.plan}
          </Badge>
        </div>
      </div>

      {/* Current Subscription Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Plan</p>
              <p className="font-medium capitalize">{companyData.subscription?.plan || "free"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="font-medium capitalize">{companyData.subscription?.status || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Max Users</p>
              <p className="font-medium">
                {companyData.subscription?.maxUsers === -1
                  ? "Unlimited"
                  : companyData.subscription?.maxUsers || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Trial Ends</p>
              <p className="font-medium">
                {companyData.subscription?.trialEndsAt
                  ? new Date(companyData.subscription.trialEndsAt).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Management Forms (Client Component) */}
      <SubscriptionForms
        companyId={id}
        currentPlan={companyData.subscription?.plan || "free"}
        currentStatus={companyData.subscription?.status || "active"}
      />

      {/* Audit Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No subscription changes recorded yet.
            </p>
          ) : (
            <div className="relative w-full overflow-x-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b">
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Date</th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Action</th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Previous</th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Updated</th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Changed By</th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Reason</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {auditLogs.map((log) => (
                    <tr key={log._id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-3 align-middle whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3 align-middle">
                        <Badge variant="outline" className="text-xs">
                          {actionLabels[log.action] || log.action}
                        </Badge>
                      </td>
                      <td className="p-3 align-middle text-xs">
                        {log.previous?.plan && <div>Plan: {log.previous.plan}</div>}
                        {log.previous?.status && <div>Status: {log.previous.status}</div>}
                        {log.previous?.maxUsers != null && <div>Users: {log.previous.maxUsers}</div>}
                      </td>
                      <td className="p-3 align-middle text-xs">
                        {log.updated?.plan && <div>Plan: {log.updated.plan}</div>}
                        {log.updated?.status && <div>Status: {log.updated.status}</div>}
                        {log.updated?.maxUsers != null && <div>Users: {log.updated.maxUsers}</div>}
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        {log.changedBy?.name || "System"}
                      </td>
                      <td className="p-3 align-middle text-xs max-w-[200px] truncate">
                        {log.reason || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
