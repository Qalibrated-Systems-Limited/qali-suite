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
import { createUser } from "@/app/mongodb/user-actions";
import { AlertCircle, Loader2, UserPlus, X, Building2, Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { userDepartments, userRolesMapping, userRoles, cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useState } from "react";

const userCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  email: z.string().email("Invalid email address"),
  role: z.enum(userRoles),
  department: z.string().optional(),
  companyId: z.string().optional(),
});

const DEPARTMENTS = userDepartments;

// Filter roles based on user type - Admin can't create SuperAdmin or Admin users
const getAvailableRoles = (isSuperAdmin) => {
  if (isSuperAdmin) {
    return userRolesMapping;
  }
  return userRolesMapping.filter(
    (r) => r.value !== "SuperAdmin" && r.value !== "Admin"
  );
};

export function CreateUserForm({ companies = [], isSuperAdmin = false }) {
  const router = useRouter();
  const initialState = { message: "", errors: {} };
  const [state, dispatch, isPending] = useActionState(createUser, initialState);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  const availableRoles = getAvailableRoles(isSuperAdmin);

  const form = useForm({
    resolver: zodResolver(userCreateSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "User",
      department: "",
      companyId: "",
    },
  });

  const handleCancel = () => {
    router.push("/dashboard/users");
  };

  const selectedCompany = companies.find((c) => c._id === selectedCompanyId);

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

                {/* Company Assignment Section - SuperAdmin only */}
                {isSuperAdmin && companies.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      Company Assignment
                    </h3>
                    <FormField
                      control={form.control}
                      name="companyId"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="text-foreground font-medium">
                            Assign to Company
                          </FormLabel>
                          <input type="hidden" name="companyId" value={selectedCompanyId} />
                          <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={companyOpen}
                                  className={cn(
                                    "w-full md:w-[400px] justify-between bg-background border-border text-foreground",
                                    !selectedCompanyId && "text-muted-foreground"
                                  )}
                                >
                                  {selectedCompany?.name || "Select a company..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search companies..." />
                                <CommandList>
                                  <CommandEmpty>No company found.</CommandEmpty>
                                  <CommandGroup>
                                    {companies.map((company) => (
                                      <CommandItem
                                        key={company._id}
                                        value={company.name}
                                        onSelect={() => {
                                          const newValue = company._id === selectedCompanyId ? "" : company._id;
                                          setSelectedCompanyId(newValue);
                                          field.onChange(newValue);
                                          setCompanyOpen(false);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            selectedCompanyId === company._id
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        {company.name}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <FormDescription className="text-xs text-muted-foreground">
                            Select which company this user belongs to. Leave empty for unassigned.
                          </FormDescription>
                          {state.errors?.companyId && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {state.errors.companyId[0]}
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                )}

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
