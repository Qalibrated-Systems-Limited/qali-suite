"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Link from "next/link";
import {
  MoreHorizontal,
  Edit,
  Trash2,
  Key,
  Power,
  Users,
  Mail,
  Shield,
  Building,
} from "lucide-react";
import { deleteUser, toggleUserStatus } from "@/app/mongodb/user-actions";
import { useRouter } from "next/navigation";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

const roleColors = {
  SuperAdmin: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  Admin: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  "Store Manager":
    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  Manager: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  Accountant: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  Technician: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  Employee: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  User: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  Viewer: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
};

const statusColors = {
  Active:
    "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  Inactive:
    "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
};

export function UsersTable({ users, currentUser, isSuperAdmin = false }) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const canEdit =
    currentUser?.role === "SuperAdmin" || currentUser?.role === "Admin" || currentUser?.role === "Store Manager";
  const canDelete = currentUser?.role === "SuperAdmin" || currentUser?.role === "Admin";

  const handleDelete = async () => {
    if (!selectedUser) return;

    setIsLoading(true);
    try {
      const result = await deleteUser(selectedUser._id);
      if (result.success) {
        router.refresh();
      } else {
        alert(result.message);
      }
    } catch (error) {
      alert("Failed to delete user");
    } finally {
      setIsLoading(false);
      setDeleteDialogOpen(false);
      setSelectedUser(null);
    }
  };

  const handleToggleStatus = async (userId) => {
    setIsLoading(true);
    try {
      const result = await toggleUserStatus(userId);
      if (result.success) {
        router.refresh();
      } else {
        alert(result.message);
      }
    } catch (error) {
      alert("Failed to update status");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <>
      {/* Desktop Table View */}
      <Card className="hidden md:block bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="font-semibold text-foreground">
                    Name
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">
                    Email
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">
                    Department
                  </TableHead>
                  {isSuperAdmin && (
                    <TableHead className="font-semibold text-foreground">
                      Company
                    </TableHead>
                  )}
                  <TableHead className="font-semibold text-foreground">
                    Role
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">
                    Status
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">
                    Created
                  </TableHead>
                  <TableHead className="text-right font-semibold text-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={isSuperAdmin ? 8 : 7}
                      className="h-24 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-8 w-8" />
                        <p>No users found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => {
                    const isCurrentUser = user._id === currentUser?.id;

                    return (
                      <TableRow
                        key={user._id}
                        className="border-b border-border hover:bg-accent transition-colors"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-yellow-500/10 rounded-full flex items-center justify-center">
                              <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
                                {user.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="font-medium text-foreground">
                              {user.name}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="text-muted-foreground">
                          {user.email}
                        </TableCell>

                        <TableCell className="text-foreground">
                          {user.department}
                        </TableCell>

                        {isSuperAdmin && (
                          <TableCell className="text-foreground">
                            {user.companyName ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Building className="w-3.5 h-3.5 text-muted-foreground" />
                                {user.companyName}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic">
                                System
                              </span>
                            )}
                          </TableCell>
                        )}

                        <TableCell>
                          <Badge
                            variant="outline"
                            className={roleColors[user.role]}
                          >
                            {user.role}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant="outline"
                            className={statusColors[user.status]}
                          >
                            {user.status}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(user.createdAt)}
                        </TableCell>

                        <TableCell className="text-right">
                          {canEdit && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-foreground"
                                  disabled={isLoading}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="bg-card border-border"
                              >
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/dashboard/users/${user._id}/update`}
                                    className="text-foreground cursor-pointer"
                                  >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit User
                                  </Link>
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedUser(user);
                                    setResetPasswordDialogOpen(true);
                                  }}
                                  className="text-foreground cursor-pointer"
                                >
                                  <Key className="mr-2 h-4 w-4" />
                                  Reset Password
                                </DropdownMenuItem>

                                {!isCurrentUser && (
                                  <DropdownMenuItem
                                    onClick={() => handleToggleStatus(user._id)}
                                    className="text-foreground cursor-pointer"
                                  >
                                    <Power className="mr-2 h-4 w-4" />
                                    {user.status === "Active"
                                      ? "Deactivate"
                                      : "Activate"}
                                  </DropdownMenuItem>
                                )}

                                {canDelete && !isCurrentUser && (
                                  <>
                                    <DropdownMenuSeparator className="bg-border" />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedUser(user);
                                        setDeleteDialogOpen(true);
                                      }}
                                      className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 cursor-pointer"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Delete User
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="space-y-4 md:hidden">
        {users.length === 0 ? (
          <Card className="p-8 text-center bg-card border-border">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No users found</p>
          </Card>
        ) : (
          users.map((user) => {
            const isCurrentUser = user._id === currentUser?.id;

            return (
              <Card key={user._id} className="p-4 bg-card border-border">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-yellow-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          {user.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={statusColors[user.status]}
                    >
                      {user.status}
                    </Badge>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Building className="w-4 h-4" />
                      <span>{user.department}</span>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building className="w-4 h-4" />
                        <span>
                          {user.companyName || (
                            <span className="italic">System</span>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-muted-foreground" />
                      <Badge
                        variant="outline"
                        className={roleColors[user.role]}
                      >
                        {user.role}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      Joined {formatDate(user.createdAt)}
                    </div>
                  </div>

                  {/* Actions */}
                  {canEdit && (
                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-border text-foreground hover:bg-accent"
                        asChild
                      >
                        <Link href={`/dashboard/users/${user._id}/update`}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-border text-foreground hover:bg-accent"
                        onClick={() => {
                          setSelectedUser(user);
                          setResetPasswordDialogOpen(true);
                        }}
                      >
                        <Key className="mr-2 h-4 w-4" />
                        Reset
                      </Button>
                      {!isCurrentUser && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-border text-foreground hover:bg-accent"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="bg-card border-border"
                          >
                            <DropdownMenuItem
                              onClick={() => handleToggleStatus(user._id)}
                              className="text-foreground cursor-pointer"
                            >
                              <Power className="mr-2 h-4 w-4" />
                              {user.status === "Active"
                                ? "Deactivate"
                                : "Activate"}
                            </DropdownMenuItem>
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator className="bg-border" />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedUser(user);
                                    setDeleteDialogOpen(true);
                                  }}
                                  className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 cursor-pointer"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Delete User
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{" "}
              <strong>{selectedUser?.name}</strong>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-accent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      {selectedUser && (
        <ResetPasswordDialog
          user={selectedUser}
          open={resetPasswordDialogOpen}
          onOpenChange={(open) => {
            setResetPasswordDialogOpen(open);
            if (!open) setSelectedUser(null);
          }}
        />
      )}
    </>
  );
}
