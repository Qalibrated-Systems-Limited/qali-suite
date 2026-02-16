import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUserById } from "@/app/mongodb/queries/user-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import {
  User,
  Mail,
  Building2,
  Shield,
  Calendar,
  Briefcase,
} from "lucide-react";
import ProfileForm from "./components/ProfileForm";
import PasswordForm from "./components/PasswordForm";

export const metadata = {
  title: "My Profile",
  description: "View and update your profile information",
};

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = await getUserById(session.user.id);
  let company = null;

  if (user?.companyId) {
    company = await getCompanyById(user.companyId);
  }

  const isGoogleUser = user?.authProvider === "google";
  const hasPassword = !!user?.hasPassword;

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  return (
    <div className="container max-w-4xl py-6 space-y-8">
      {/* Profile Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-8">
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex flex-col sm:flex-row items-center gap-6">
          {/* Avatar */}
          {user?.avatar ? (
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
          <div className="text-center sm:text-left">
            <h1 className="text-3xl font-bold text-white">{user?.name}</h1>
            <p className="text-white/80 flex items-center justify-center sm:justify-start gap-2 mt-1">
              <Mail className="h-4 w-4" />
              {user?.email}
            </p>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-sm backdrop-blur-sm">
                <Shield className="h-3.5 w-3.5" />
                {user?.role}
              </span>
              {user?.department && (
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
                <span className={`h-2 w-2 rounded-full ${user?.status === "Active" ? "bg-green-500" : "bg-gray-400"}`} />
                {user?.status || "Active"}
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
              <p className="text-sm text-muted-foreground">Member Since</p>
              <p className="font-semibold">
                {user?.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-US", {
                      month: "short",
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
              <p className="font-semibold">{user?.role}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Forms */}
      <div className={`grid grid-cols-1 ${!isGoogleUser ? "lg:grid-cols-2" : ""} gap-6`}>
        {/* Profile Information */}
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              Profile Information
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Update your personal details
            </p>
          </div>
          <div className="p-6">
            <ProfileForm user={user} />
          </div>
        </div>

        {/* Password — for all non-Google users (set or change) */}
        {!isGoogleUser && (
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Shield className="h-5 w-5 text-muted-foreground" />
                Security
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {hasPassword ? "Change your password" : "Set up a password"}
              </p>
            </div>
            <div className="p-6">
              <PasswordForm hasPassword={hasPassword} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
