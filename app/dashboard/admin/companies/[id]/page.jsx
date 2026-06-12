import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import ResetTransactionsCard from "../components/ResetTransactionsCard";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  ArrowLeft,
  Edit,
  Mail,
  Phone,
  Globe,
  MapPin,
  CreditCard,
  Smartphone,
  Calendar,
  Users,
  Shield,
} from "lucide-react";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const company = await getCompanyById(id);
  return {
    title: company?.name || "Company Details",
  };
}

const statusColors = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  inactive: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  suspended: "bg-red-500/10 text-red-600 border-red-500/20",
};

const planColors = {
  free: "bg-gray-500/10 text-gray-600",
  starter: "bg-blue-500/10 text-blue-600",
  professional: "bg-purple-500/10 text-purple-600",
  enterprise: "bg-yellow-500/10 text-yellow-600",
};

export default async function CompanyDetailPage({ params }) {
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
            Only SuperAdmin can view company details.
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
        <Link href="/dashboard/admin/companies">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Companies
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-yellow-500/10 rounded-lg">
            <Building2 className="h-8 w-8 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            {company.tagline && (
              <p className="text-muted-foreground">{company.tagline}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusColors[company.status]}>
            {company.status}
          </Badge>
          <Badge variant="outline" className={planColors[company.subscription?.plan]}>
            {company.subscription?.plan}
          </Badge>
          <Button variant="outline" asChild>
            <Link href={`/dashboard/admin/companies/${company._id}/subscription`}>
              <Shield className="h-4 w-4 mr-2" />
              Subscription
            </Link>
          </Button>
          <Button asChild className="bg-yellow-500 text-black hover:bg-yellow-600">
            <Link href={`/dashboard/admin/companies/${company._id}/edit`}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{company.email}</span>
            </div>
            {company.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{company.phone}</span>
              </div>
            )}
            {company.website && (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {company.website}
                </a>
              </div>
            )}
            {company.fullAddress && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
                <span>{company.fullAddress}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Subscription
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <Badge variant="outline" className={planColors[company.subscription?.plan]}>
                {company.subscription?.plan}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{company.subscription?.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Users</span>
              <span>{company.subscription?.maxUsers}</span>
            </div>
            {company.subscription?.trialEndsAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trial Ends</span>
                <span>
                  {new Date(company.subscription.trialEndsAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tax & Legal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tax & Legal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">KRA PIN</span>
              <span className="font-mono">{company.taxPin || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT Number</span>
              <span>{company.vatNumber || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Registration No.</span>
              <span>{company.registrationNumber || "-"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Bank Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bank</span>
              <span>{company.bankName || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Branch</span>
              <span>{company.bankBranch || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account Name</span>
              <span>{company.accountName || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account No.</span>
              <span className="font-mono">{company.accountNumber || "-"}</span>
            </div>
          </CardContent>
        </Card>

        {/* M-Pesa */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              M-Pesa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paybill</span>
              <span className="font-mono">{company.mpesaPaybill || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Till Number</span>
              <span className="font-mono">{company.mpesaTill || "-"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Currency</span>
              <span>{company.settings?.currency || "KES"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT Rate</span>
              <span>{company.settings?.defaultVatRate || 16}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment Terms</span>
              <span>{company.settings?.defaultPaymentTermsDays || 30} days</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Info */}
      {/* Danger zone — SuperAdmin transactional reset */}
      <ResetTransactionsCard
        companyId={company._id.toString()}
        companyName={company.name}
      />

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Created: {new Date(company.createdAt).toLocaleString()}
              {company.createdBy?.name && ` by ${company.createdBy.name}`}
            </div>
            {company.updatedAt && (
              <div>
                Last updated: {new Date(company.updatedAt).toLocaleString()}
                {company.lastModifiedBy?.name && ` by ${company.lastModifiedBy.name}`}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
