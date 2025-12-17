"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Key, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { resetUserPassword } from "@/app/mongodb/user-actions";
import { useEffect, useState } from "react";

export function ResetPasswordDialog({ user, open, onOpenChange }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const resetWithId = resetUserPassword.bind(null, user._id);
  const [state, dispatch, isPending] = useActionState(resetWithId, {
    message: "",
    errors: {},
    success: false,
  });

  // Reset form and close dialog on success
  useEffect(() => {
    if (state.success) {
      setTimeout(() => {
        setNewPassword("");
        setConfirmPassword("");
        onOpenChange(false);
        router.refresh();
      }, 1500);
    }
  }, [state.success, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Key className="w-5 h-5 text-yellow-500" />
            Reset Password
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Reset password for{" "}
            <strong className="text-foreground">{user.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <form action={dispatch} className="space-y-4 py-4">
          {/* Success Alert */}
          {state.success && (
            <Alert className="bg-green-500/10 border-green-500/20">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-600 dark:text-green-400">
                Password reset successfully!
              </AlertDescription>
            </Alert>
          )}

          {/* Error Alert */}
          {state.message && !state.success && (
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

          {/* New Password */}
          <div className="space-y-2">
            <Label
              htmlFor="newPassword"
              className="text-foreground font-medium"
            >
              New Password <span className="text-red-500">*</span>
            </Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-background border-border text-foreground"
              disabled={isPending || state.success}
              required
            />
            {state.errors?.newPassword && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {state.errors.newPassword[0]}
              </p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label
              htmlFor="confirmPassword"
              className="text-foreground font-medium"
            >
              Confirm Password <span className="text-red-500">*</span>
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="bg-background border-border text-foreground"
              disabled={isPending || state.success}
              required
            />
            {state.errors?.confirmPassword && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {state.errors.confirmPassword[0]}
              </p>
            )}
          </div>

          {/* Password Requirements */}
          <div className="p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground font-medium mb-2">
              Password Requirements:
            </p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• At least 6 characters long</li>
              <li>• Both passwords must match</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending || state.success}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || state.success}
              className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : state.success ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Success!
                </>
              ) : (
                <>
                  <Key className="mr-2 h-4 w-4" />
                  Reset Password
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
