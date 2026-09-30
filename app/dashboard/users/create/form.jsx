"use client";

import { useActionState } from "react";
import NextForm from "next/form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createUserPg } from "@/app/db/actions/user-actions";
import { AlertCircle, Loader2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { userDepartments, userRolesMapping } from "@/lib/utils";

const userCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  email: z.string().email("Invalid email address"),
  // Canonical or custom role — validated server-side against this company.
  role: z.string().min(1, "A role is required"),
  department: z.string().optional(),
});

const DEPARTMENTS = userDepartments;

// Filter roles based on user type - Admin can't create SuperAdmin or Admin users,
// then append this company's custom roles (0120).
const getAvailableRoles = (isSuperAdmin, customRoles = []) => {
  const base = isSuperAdmin
    ? userRolesMapping
    : userRolesMapping.filter(
        (r) => r.value !== "SuperAdmin" && r.value !== "Admin",
      );
  const custom = customRoles.map((r) => ({
    value: r.name,
    label: `${r.name} — acts as ${r.baseRole}`,
  }));
  return [...base, ...custom];
};

export function CreateUserForm({ isSuperAdmin = false, customRoles = [] }) {
  const router = useRouter();
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(createUserPg, initialState);

  const availableRoles = getAvailableRoles(isSuperAdmin, customRoles);

  const form = useForm({
    resolver: zodResolver(userCreateSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "Employee",
      department: "",
    },
  });

  const handleCancel = () => {
    router.push("/dashboard/users");
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <Card className="bg-card border-border">
        <CardHeader className="space-y-1 border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold text-foreground">
                Create New User
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Add a new user account to the system
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          <Form {...form}>
            <NextForm action={dispatch} className="space-y-8">
              {/* Error Alert */}
              {state.message && (
                <Alert
                  variant="destructive"
                  className="bg-red-500/10 border-red-500/20"
                >
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <AlertDescription className="text-red-600 dark:text-red-400">
                    {state.message}
                  </AlertDescription>
                </Alert>
              )}

              {/* Personal Information Section */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Personal Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Name */}
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Full Name <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., John Doe"
                              className="bg-background border-border text-foreground"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            User's full legal name
                          </FormDescription>
                          {state.errors?.name && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.name[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />

                    {/* Email */}
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Email Address{" "}
                            <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="e.g., john.doe@company.com"
                              className="bg-background border-border text-foreground"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs text-muted-foreground">
                            Used for login and notifications
                          </FormDescription>
                          {state.errors?.email && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.email[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Role & Department Section */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Role & Department
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Role */}
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Role <span className="text-red-500">*</span>
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            name="role"
                          >
                            <FormControl>
                              <SelectTrigger className="bg-background border-border text-foreground">
                                <SelectValue placeholder="Select a role" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-card border-border">
                              {availableRoles.map(({ label, value }) => (
                                <SelectItem
                                  key={value}
                                  value={value}
                                  className="text-foreground"
                                >
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs text-muted-foreground">
                            Determines user permissions
                          </FormDescription>
                          {state.errors?.role && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.role[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />

                    {/* Department */}
                    <FormField
                      control={form.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground font-medium">
                            Department
                          </FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            name="department"
                          >
                            <FormControl>
                              <SelectTrigger className="bg-background border-border text-foreground">
                                <SelectValue placeholder="Select a department" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-card border-border">
                              {DEPARTMENTS.map((dept) => (
                                <SelectItem
                                  key={dept}
                                  value={dept}
                                  className="text-foreground"
                                >
                                  {dept}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs text-muted-foreground">
                            User's department or team
                          </FormDescription>
                          {state.errors?.department && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.department[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Which company this user is created in.
                    There was a company PICKER here, for SuperAdmins. It posted
                    a hidden `companyId` that `createUser` never read: the
                    action takes its companyId from withAuthorizedTenant, i.e.
                    the company selected in the switcher. So the choice was
                    silently ignored, and the seat check ran against the
                    switcher's company too — a user could be created, and
                    billed, against a tenant nobody chose.

                    Not wired up instead, deliberately. "Authorisation is a set;
                    operating context is one of it" (app/db/tenant.ts): grants
                    say which companies you may enter, the switcher says which
                    one you are in, and RLS scopes every write to that one.
                    Letting one form write into a company you are not switched
                    to would be the only path in the app that steps around
                    that. */}
                <div className="p-4 bg-muted/50 border border-border rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    This user will be created in the company you are currently
                    working in. To add someone to a different company, switch to
                    it in the company selector first.
                  </p>
                </div>

                {/* Info Box */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    <strong>Note:</strong> The user will need to sign in with
                    Google or set a password from their profile on first login.
                    Consider using <strong>Invite User</strong> to send them a
                    setup link instead.
                  </p>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-3 pt-6 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border text-foreground hover:bg-accent"
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create User
                    </>
                  )}
                </Button>
              </div>
            </NextForm>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
