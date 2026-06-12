import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import CompanyForm from "./components/companyForm";
import { Building2 } from "lucide-react";

export const metadata = {
  title: "Company Settings",
  description: "Manage your company information",
};

export default async function CompanySettingsPage() {
  const session = await auth();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  // Only Admin can access company settings
  if (!["Admin", "SuperAdmin"].includes(user.role)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-destructive">Not Authorized</h1>
          <p className="text-muted-foreground mt-2">
            You need Admin access to manage company settings.
          </p>
        </div>
      </div>
    );
  }

  // Get company data
  let company = null;
  if (user.companyId) {
    company = await getCompanyById(user.companyId);
  }

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="hidden p-2 bg-yellow-500/10 rounded-lg sm:block">
          <Building2 className="h-6 w-6 text-yellow-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold sm:text-2xl">Company Settings</h1>
          <p className="text-muted-foreground">
            {company
              ? "Update your company information"
              : "Set up your company profile"}
          </p>
        </div>
      </div>

      {/* Form */}
      <CompanyForm company={company} isSuperAdmin={user.role === "SuperAdmin"} />
    </div>
  );
}
