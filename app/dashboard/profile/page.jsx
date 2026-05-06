import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUserById } from "@/app/mongodb/queries/user-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { getMyEmployeeProfile } from "@/app/mongodb/queries/hr-queries";
import {
  User,
  Mail,
  Building2,
  Shield,
  Calendar,
  Briefcase,
  Hash,
  Clock,
  MapPin,
  Users,
  Phone,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import ProfileForm from "./components/ProfileForm";
import PasswordForm from "./components/PasswordForm";
import Link from "next/link";

export const metadata = {
  title: "My Profile",
  description: "View and update your profile information",
};

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const [user, empProfile] = await Promise.all([
    getUserById(session.user.id),
    getMyEmployeeProfile(),
  ]);

  let company = null;
  if (user?.companyId) {
    company = await getCompanyById(user.companyId);
  }

  const isGoogleUser = user?.authProvider === "google";
  const hasPassword = !!user?.hasPassword;

  // Photo priority: employee profile photo → Google avatar → initials
  const photo = empProfile?.photo || user?.avatar || null;
  const displayName = empProfile?.name || user?.name || "User";
  const department = empProfile?.department || user?.department || null;

  const initials =
    displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <div className="container max-w-4xl py-6 space-y-8">
      {/* Profile Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 pb-2">
        {/* Avatar */}
        {photo ? (
          <img
            src={photo}
            alt={displayName}
            className="h-20 w-20 rounded-full object-cover ring-2 ring-border shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center text-foreground text-2xl font-bold ring-2 ring-border shrink-0">
            {initials}
          </div>
        )}

        {/* Info */}
        <div className="text-center sm:text-left min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{displayName}</h1>
          {empProfile?.designation && (
            <p className="text-muted-foreground text-sm mt-0.5">{empProfile.designation}</p>
          )}
          <p className="text-muted-foreground text-sm flex items-center justify-center sm:justify-start gap-1.5 mt-1">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            {user?.email}
          </p>
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border bg-muted text-foreground text-xs font-medium">
              <Shield className="h-3 w-3" />
              {user?.role}
            </span>
            {empProfile?.employeeNumber && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border bg-muted text-foreground text-xs font-mono">
                <Hash className="h-3 w-3" />
                {empProfile.employeeNumber}
              </span>
            )}
            {department && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border bg-muted text-foreground text-xs">
                <Briefcase className="h-3 w-3" />
                {department}
              </span>
            )}
            {company && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border bg-muted text-foreground text-xs">
                <Building2 className="h-3 w-3" />
                {company.name}
              </span>
            )}
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
              <p className="text-sm text-muted-foreground">
                {empProfile ? "Employment Status" : "Account Status"}
              </p>
              <p className="font-semibold flex items-center gap-2 capitalize">
                <span
                  className={`h-2 w-2 rounded-full ${
                    (empProfile?.status || user?.status) === "active" || user?.status === "Active"
                      ? "bg-green-500"
                      : "bg-gray-400"
                  }`}
                />
                {empProfile?.status?.replace("_", " ") || user?.status || "Active"}
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
              <p className="text-sm text-muted-foreground">
                {empProfile?.hireDate ? "Hire Date" : "Member Since"}
              </p>
              <p className="font-semibold">
                {empProfile?.hireDate || user?.createdAt
                  ? new Date(empProfile?.hireDate || user.createdAt).toLocaleDateString("en-US", {
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
              {empProfile?.employmentType ? (
                <Clock className="h-5 w-5 text-purple-600" />
              ) : (
                <Shield className="h-5 w-5 text-purple-600" />
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {empProfile?.employmentType ? "Employment Type" : "Access Level"}
              </p>
              <p className="font-semibold capitalize">
                {empProfile?.employmentType?.replace("_", " ") || user?.role}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Employment Details — only when employee profile exists */}
      {empProfile && <EmploymentDetails emp={empProfile} />}

      {/* Edit Forms */}
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
            <ProfileForm user={user} hasEmployeeProfile={!!empProfile} />
          </div>
        </div>

        {/* Password — for all non-Google users */}
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

// ============================================
// EMPLOYMENT DETAILS (read-only, from EmployeeProfile)
// ============================================
function EmploymentDetails({ emp }) {
  const fmt = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;

  const TYPE_LABEL = {
    full_time: "Full-time",
    part_time: "Part-time",
    contract: "Contract",
    intern: "Intern",
    casual: "Casual",
  };

  const CONTRACT_LABEL = {
    fixed_term: "Fixed Term",
    renewable: "Renewable",
    project_based: "Project Based",
  };

  const rows = [
    { icon: Briefcase,  label: "Department",      value: emp.department },
    { icon: Hash,       label: "Designation",     value: emp.designation },
    { icon: Clock,      label: "Employment Type", value: TYPE_LABEL[emp.employmentType] || emp.employmentType },
    { icon: MapPin,     label: "Work Location",   value: emp.workLocation },
    { icon: Users,      label: "Reporting To",    value: emp.managerName },
    { icon: CreditCard, label: "Job Grade",       value: emp.jobGrade },
    { icon: Calendar,   label: "Hire Date",       value: fmt(emp.hireDate) },
    { icon: Calendar,   label: "Confirmed On",    value: fmt(emp.confirmationDate) },
    ...(emp.contractEnd
      ? [
          { icon: Calendar, label: "Contract Type", value: CONTRACT_LABEL[emp.contractType] || emp.contractType },
          { icon: Calendar, label: "Contract End",  value: fmt(emp.contractEnd) },
        ]
      : []),
    ...(emp.shiftStart
      ? [{ icon: Clock, label: "Shift Hours", value: `${emp.shiftStart} – ${emp.shiftEnd || "—"}` }]
      : []),
  ].filter((r) => r.value);

  const idRows = [
    { label: "National ID",  value: emp.nationalId },
    { label: "KRA PIN",      value: emp.kraPin },
    { label: "NSSF No.",     value: emp.nssfNumber },
    { label: "SHA No.",      value: emp.shaNumber },
    { label: "Nationality",  value: emp.nationality },
    { label: "Gender",       value: emp.gender ? emp.gender.charAt(0).toUpperCase() + emp.gender.slice(1) : null },
    { label: "Date of Birth",value: fmt(emp.dateOfBirth) },
  ].filter((r) => r.value);

  if (!rows.length && !idRows.length && !emp.emergencyContact) return null;

  return (
    <div className="space-y-4">
      {/* Employment */}
      {rows.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-muted/30 flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Employment Details
            </h2>
            <Link href="/dashboard/hr/my-attendance" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
              My attendance <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <dl className="divide-y divide-border">
            {rows.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-4 px-6 py-3">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <dt className="text-sm text-muted-foreground w-36 shrink-0">{label}</dt>
                <dd className="text-sm font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Personal / ID numbers */}
      {idRows.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-muted/30">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Personal &amp; ID Information
            </h2>
          </div>
          <dl className="divide-y divide-border">
            {idRows.map(({ label, value }) => (
              <div key={label} className="flex items-center gap-4 px-6 py-3">
                <dt className="text-sm text-muted-foreground w-36 shrink-0 ml-8">{label}</dt>
                <dd className="text-sm font-medium text-foreground font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Emergency Contact */}
      {emp.emergencyContact?.name && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-muted/30">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              Emergency Contact
            </h2>
          </div>
          <div className="px-6 py-4 flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Name</p>
              <p className="font-medium">{emp.emergencyContact.name}</p>
            </div>
            {emp.emergencyContact.relationship && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Relationship</p>
                <p className="font-medium">{emp.emergencyContact.relationship}</p>
              </div>
            )}
            {emp.emergencyContact.phone && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Phone</p>
                <p className="font-medium font-mono">{emp.emergencyContact.phone}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
