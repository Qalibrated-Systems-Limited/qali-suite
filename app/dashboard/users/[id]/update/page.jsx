import { EditUserForm } from "./form";
import { auth } from "@/auth";
import { getUserById } from "@/app/mongodb/queries/user-queries";
import { getCompaniesForDropdown } from "@/app/mongodb/queries/company-queries";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

async function EditUserPage(props) {
  const params = await props.params;
  const userId = params.id;

  const session = await auth();
  const currentUser = session?.user;
  const isSuperAdmin = currentUser?.role === "SuperAdmin";
  const canEditUser =
    currentUser?.role === "Admin" || currentUser?.role === "Manager" || isSuperAdmin;

  if (!canEditUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <Card className="max-w-md w-full bg-card border-border">
          <CardContent className="pt-6">
            <Alert
              variant="destructive"
              className="bg-red-500/10 border-red-500/20"
            >
              <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
              <AlertTitle className="text-red-600 dark:text-red-400 font-semibold">
                Access Denied
              </AlertTitle>
              <AlertDescription className="text-red-600 dark:text-red-400 mt-2">
                You don't have permission to edit users. Only Administrators and
                Store Managers can modify user accounts.
              </AlertDescription>
            </Alert>
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                className="border-border text-foreground hover:bg-accent"
                asChild
              >
                <Link href="/dashboard/users">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Users
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fetch user data
  let user = await getUserById(userId);

  if (!user) {
    return notFound();
  } else {
    user = {
      ...user,
      cart: [],
      _id: user._id.toString(),
      companyId: user.companyId?.toString() || "",
      createdAt: user.createdAt?.toString(),
      updatetAt: user.updatetAt?.toString(),
    };
  }

  // Fetch companies for SuperAdmin
  let companies = [];
  if (isSuperAdmin) {
    companies = await getCompaniesForDropdown();
  }

  return (
    <main className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard/users"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Users
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground hover:text-foreground transition-colors">
          {user.name}
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground font-medium">Edit</span>
      </div>

      {/* Form */}
      <EditUserForm user={user} companies={companies} isSuperAdmin={isSuperAdmin} />
    </main>
  );
}

export default EditUserPage;
