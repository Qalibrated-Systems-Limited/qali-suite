import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import CompanyForm from "@/app/dashboard/company/components/companyForm";
import { Button } from "@/components/ui/button";
import { Building2, ArrowLeft } from "lucide-react";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const company = await getCompanyById(id);
  return {
    title: `Edit ${company?.name || "Company"}`,
  };
}

export default async function EditCompanyPage({ params }) {
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
            Only SuperAdmin can edit companies.
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

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Back Button */}
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/dashboard/admin/companies/${company._id}`}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Details
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="hidden p-2 bg-yellow-500/10 rounded-lg sm:block">
          <Building2 className="h-6 w-6 text-yellow-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold sm:text-2xl">Edit Company</h1>
          <p className="text-muted-foreground">{company.name}</p>
        </div>
      </div>

      {/* Form */}
      <CompanyForm company={company} isSuperAdmin={true} />
    </div>
  );
}
