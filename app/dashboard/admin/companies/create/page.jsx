import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CompanyForm from "@/app/dashboard/company/components/companyForm";
import { Building2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Create Company",
  description: "Add a new company to the system",
};

export default async function CreateCompanyPage() {
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
            Only SuperAdmin can create companies.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Back Button */}
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/admin/companies">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Companies
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="hidden p-2 bg-yellow-500/10 rounded-lg sm:block">
          <Building2 className="h-6 w-6 text-yellow-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold sm:text-2xl">Create Company</h1>
          <p className="text-muted-foreground">
            Add a new tenant company to the system
          </p>
        </div>
      </div>

      {/* Form */}
      <CompanyForm isSuperAdmin={true} />
    </div>
  );
}
