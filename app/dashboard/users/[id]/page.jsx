import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getUserById } from "@/app/mongodb/queries/user-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import Link from "next/link";
import {
  User,
  Mail,
  Building2,
  Shield,
  Calendar,
  Briefcase,
  ArrowLeft,
  Pencil,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "User Details",
  description: "View user information",
};

export default async function UserDetailsPage({ params, searchParams }) {
  const { id } = await params;
  const { created, email: emailStatus, emailError } = await searchParams;

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const currentUser = session.user;
  const canViewUsers = ["SuperAdmin", "Admin", "Manager"].includes(currentUser.role);

  if (!canViewUsers) {
    redirect("/dashboard");
  }

  const user = await getUserById(id);

  if (!user) {
    notFound();
  }

  // Non-SuperAdmin can only view users in their own company
  if (currentUser.role !== "SuperAdmin") {
    if (user.companyId?.toString() !== currentUser.companyId) {
      redirect("/dashboard/users");
    }
  }

  let company = null;
  if (user?.companyId) {
    company = await getCompanyById(user.companyId);
  }

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  const canEdit = currentUser.role === "SuperAdmin" ||
    (currentUser.role === "Admin" && !["SuperAdmin", "Admin"].includes(user.role));

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Success Message */}
      {created === "true" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              User created successfully!{" "}
              {emailStatus === "sent"
                ? "An invite email has been sent to set up their account."
                : ""}
            </p>
          </div>
          {emailStatus === "failed" && (
            <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Mail className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div className="text-sm text-amber-600 dark:text-amber-400">
                <p className="font-medium">Failed to send invite email.</p>
                {emailError && <p className="mt-1 text-xs opacity-80">{decodeURIComponent(emailError)}</p>}
                <p className="mt-1 text-xs">You can resend the invite from the Users page.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard/users"
          className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Users
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground font-medium">{user.name}</span>
      </div>

      {/* Profile Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 p-8">
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex flex-col sm:flex-row items-center gap-6">
          {/* Avatar */}
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="h-24 w-24 rounded-full object-cover shadow-xl ring-4 ring-white/30"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="h-24 w-24 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-3xl font-bold shadow-xl ring-4 ring-white/30">
              {initials}
            </div>
          )}

          {/* Info */}
          <div className="text-center sm:text-left flex-1">
            <h1 className="text-3xl font-bold text-white">{user.name}</h1>
            <p className="text-white/80 flex items-center justify-center sm:justify-start gap-2 mt-1">
              <Mail className="h-4 w-4" />
              {user.email}
            </p>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-sm backdrop-blur-sm">
                <Shield className="h-3.5 w-3.5" />
                {user.role}
              </span>
              {user.department && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-sm backdrop-blur-sm">
                  <Briefcase className="h-3.5 w-3.5" />
                  {user.department}
                </span>
              )}
              {company && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-sm backdrop-blur-sm">
                  <Building2 className="h-3.5 w-3.5" />
                  {company.name}
                </span>
              )}
            </div>
          </div>

          {/* Edit Button */}
          {canEdit && (
            <Button
              asChild
              variant="secondary"
              className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
            >
              <Link href={`/dashboard/users/${id}/update`}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit User
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-green-500/10">
              <User className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="font-semibold flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${user.status === "Active" ? "bg-green-500" : "bg-gray-400"}`} />
                {user.status || "Active"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="font-semibold">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10">
              <Shield className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Access Level</p>
              <p className="font-semibold">{user.role}</p>
            </div>
          </div>
        </div>
      </div>

      {/* User Details */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            User Information
          </h2>
        </div>
        <div className="p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Full Name</dt>
              <dd className="mt-1 text-foreground">{user.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Email Address</dt>
              <dd className="mt-1 text-foreground">{user.email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Role</dt>
              <dd className="mt-1 text-foreground">{user.role}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Department</dt>
              <dd className="mt-1 text-foreground">{user.department || "Not assigned"}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Company</dt>
              <dd className="mt-1 text-foreground">{company?.name || "Not assigned"}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  user.status === "Active"
                    ? "bg-green-500/10 text-green-600"
                    : "bg-gray-500/10 text-gray-600"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    user.status === "Active" ? "bg-green-500" : "bg-gray-400"
                  }`} />
                  {user.status || "Active"}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button variant="outline" asChild>
          <Link href="/dashboard/users">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Link>
        </Button>
        {canEdit && (
          <Button asChild>
            <Link href={`/dashboard/users/${id}/update`}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit User
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
