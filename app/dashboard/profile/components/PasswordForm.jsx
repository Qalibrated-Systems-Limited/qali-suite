"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, Check, Eye, EyeOff, KeyRound } from "lucide-react";
import { changePassword } from "@/app/mongodb/actions/profile-actions";

export default function PasswordForm({ hasPassword = true }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    if (formData.newPassword !== formData.confirmPassword) {
      setError("New passwords do not match");
      setLoading(false);
      return;
    }

    if (formData.newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    try {
      const result = await changePassword({
        currentPassword: hasPassword ? formData.currentPassword : undefined,
        newPassword: formData.newPassword,
      });

      if (result.success) {
        setSuccess(true);
        setFormData({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        });
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(result.error || "Failed to change password");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const toggleVisibility = (field) => {
    setShowPasswords((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!hasPassword && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            You don't have a password yet. Set one to sign in with email &amp;
            password.
          </p>
        </div>
      )}

      {hasPassword && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Current Password
          </label>
          <div className="relative">
            <input
              type={showPasswords.current ? "text" : "password"}
              value={formData.currentPassword}
              onChange={(e) =>
                setFormData({ ...formData, currentPassword: e.target.value })
              }
              placeholder="Enter current password"
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
            <button
              type="button"
              onClick={() => toggleVisibility("current")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPasswords.current ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-2">
          {hasPassword ? "New Password" : "Password"}
        </label>
        <div className="relative">
          <input
            type={showPasswords.new ? "text" : "password"}
            value={formData.newPassword}
            onChange={(e) =>
              setFormData({ ...formData, newPassword: e.target.value })
            }
            placeholder={
              hasPassword ? "Enter new password" : "Min 6 characters"
            }
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <button
            type="button"
            onClick={() => toggleVisibility("new")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPasswords.new ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          Confirm {hasPassword ? "New " : ""}Password
        </label>
        <div className="relative">
          <input
            type={showPasswords.confirm ? "text" : "password"}
            value={formData.confirmPassword}
            onChange={(e) =>
              setFormData({ ...formData, confirmPassword: e.target.value })
            }
            placeholder="Confirm password"
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <button
            type="button"
            onClick={() => toggleVisibility("confirm")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPasswords.confirm ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
          {error}
        </p>
      )}

      {success && (
        <p className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2">
          <Check className="h-4 w-4" />
          {hasPassword
            ? "Password changed successfully"
            : "Password set successfully"}
        </p>
      )}

      <Button
        type="submit"
        disabled={loading}
        variant="outline"
        className="w-full"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {hasPassword ? "Changing..." : "Setting..."}
          </>
        ) : (
          <>
            <Lock className="h-4 w-4 mr-2" />
            {hasPassword ? "Change Password" : "Set Password"}
          </>
        )}
      </Button>
    </form>
  );
}
