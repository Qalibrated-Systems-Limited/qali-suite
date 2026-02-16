"use client";

import { useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Send, Loader2, AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { sendInvite } from "@/app/mongodb/actions/invite-actions";
import { userRolesMapping } from "@/lib/utils";

export default function InviteUserDialog({ isSuperAdmin = false }) {
  const [open, setOpen] = useState(false);
  const [state, dispatch, isPending] = useActionState(sendInvite, {});

  // Filter roles: Admin can't invite Admin/SuperAdmin
  const availableRoles = isSuperAdmin
    ? userRolesMapping
    : userRolesMapping.filter(
        (r) => r.value !== "SuperAdmin" && r.value !== "Admin"
      );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-border text-foreground hover:bg-accent"
        >
          <Send className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Invite User</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Send an email invitation to add a new user to your company
          </DialogDescription>
        </DialogHeader>

        {state.success ? (
          <div className="text-center space-y-4 py-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm text-foreground font-medium">
              {state.message}
            </p>
            <Button
              variant="outline"
              className="border-border"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        ) : (
          <form action={dispatch} className="space-y-4">
            {/* Error */}
            {state.error && (
              <Alert
                variant="destructive"
                className="bg-red-500/10 border-red-500/20"
              >
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-600 dark:text-red-400">
                  {state.error}
                </AlertDescription>
              </Alert>
            )}

            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  name="email"
                  type="email"
                  placeholder="user@example.com"
                  required
                  className="pl-10 bg-background border-border"
                  disabled={isPending}
                />
              </div>
            </div>

            {/* Role */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Role
              </label>
              <Select name="role" defaultValue="User" required>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
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
              <p className="text-xs text-muted-foreground">
                The invited user will be assigned this role
              </p>
            </div>

            {/* Info */}
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-600 dark:text-blue-400">
                The user will receive an email with a link to accept the invite
                and set up their account (via Google or password).
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-border"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
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
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send Invite
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
