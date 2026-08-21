"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, UserX, Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  confirmEmployee,
  terminateEmployee,
  inviteEmployeeToPortal,
} from "@/app/db/actions/hr-employee-actions";
import { HR_WRITE_ROLES, HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";

/** Today, on the LOCAL calendar — `toISOString()` is UTC and shifts the day. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ConfirmDialog({ open, onClose, title, description, confirmLabel, onConfirm, isPending, error, variant = "default" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={variant}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

const INVITE_ROLES = [
  { value: "Employee", label: "Employee", desc: "View own payslips, leave, attendance" },
  { value: "Manager", label: "Manager", desc: "Approve leave, view team data" },
  { value: "HR Manager", label: "HR Manager", desc: "Full HR access — employees, payroll, leave" },
  { value: "Accountant", label: "Accountant", desc: "Finance, reports, tax compliance" },
  { value: "Store Manager", label: "Store Manager", desc: "Inventory, stock requests" },
  { value: "Admin", label: "Admin", desc: "Full system access" },
];

function InviteDialog({ open, onClose, onConfirm, isPending, error, email }) {
  const [selectedRole, setSelectedRole] = useState("Employee");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">Send Portal Invite</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite <span className="font-medium text-foreground">{email}</span> to sign in to the portal.
        </p>

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-foreground">Portal Role</label>
          <div className="space-y-2">
            {INVITE_ROLES.map((r) => (
              <label
                key={r.value}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  selectedRole === r.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="inviteRole"
                  value={r.value}
                  checked={selectedRole === r.value}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(selectedRole)} disabled={isPending}>
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Send Invite
          </Button>
        </div>
      </div>
    </div>
  );
}

function TerminateDialog({ open, onClose, onConfirm, isPending, error }) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-destructive">Terminate Employee</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This ends the employment, deactivates their login immediately, and
          closes their party record. It cannot be undone from here.
        </p>
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-foreground">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="e.g. Resigned, End of contract..."
          />
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onConfirm(reason)}
            disabled={isPending || !reason.trim()}
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Terminate
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EmployeeActions({ employeeId, status, hasLogin, userRole, email }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState(null);

  const canConfirm = status === "probation" && roleAllowed(userRole, HR_WRITE_ROLES);
  // HR_ADMIN_ROLES, not `userRole === "Admin"`. The action has always allowed
  // SuperAdmin and HR Manager to terminate; the button did not offer it to
  // them, so the only way HR could end an employment was to ask an Admin.
  const canTerminate = status !== "terminated" && roleAllowed(userRole, HR_ADMIN_ROLES);
  const canInvite = !hasLogin && roleAllowed(userRole, HR_ADMIN_ROLES);

  function handleConfirm() {
    setDialogError(null);
    startTransition(async () => {
      const result = await confirmEmployee(employeeId);
      if (result?.success === false) {
        setDialogError(result.error);
      } else {
        setDialog(null);
        toast.success("Employee confirmed as active");
        router.refresh();
      }
    });
  }

  function handleTerminate(reason) {
    setDialogError(null);
    const formData = new FormData();
    formData.set("employeeId", employeeId);
    formData.set("terminationDate", today());
    formData.set("reason", reason);
    startTransition(async () => {
      const result = await terminateEmployee(null, formData);
      if (result?.success === false) {
        setDialogError(result.error);
      } else {
        setDialog(null);
        // The login is closed separately, and a failure there is worth saying.
        if (result?.warning) toast.warning(result.warning);
        else toast.success("Employment ended and the login deactivated");
        router.refresh();
      }
    });
  }

  function handleInvite(selectedRole) {
    setDialogError(null);
    startTransition(async () => {
      const result = await inviteEmployeeToPortal(employeeId, selectedRole);
      if (result?.success === false) {
        setDialogError(result.error);
      } else if (result?.warning) {
        setDialog(null);
        toast.warning(result.message);
        router.refresh();
      } else {
        setDialog(null);
        toast.success(result.message || "Invite sent");
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canInvite && (
          <Button variant="outline" size="sm" onClick={() => { setDialogError(null); setDialog("invite"); }} disabled={isPending}>
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Send Portal Invite</span>
          </Button>
        )}
        {hasLogin && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Portal Access Active
          </span>
        )}
        {canConfirm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setDialogError(null); setDialog("confirm"); }}
            disabled={isPending}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-500/10 dark:border-emerald-700 dark:text-emerald-400"
          >
            <UserCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Confirm Employment</span>
          </Button>
        )}
        {canTerminate && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setDialogError(null); setDialog("terminate"); }}
            disabled={isPending}
            className="border-destructive/30 text-destructive hover:bg-destructive/5"
          >
            <UserX className="h-4 w-4" />
            Terminate
          </Button>
        )}
      </div>

      <InviteDialog
        open={dialog === "invite"}
        onClose={() => setDialog(null)}
        onConfirm={handleInvite}
        isPending={isPending}
        error={dialogError}
        email={email}
      />

      <ConfirmDialog
        open={dialog === "confirm"}
        onClose={() => setDialog(null)}
        title="Confirm Employment"
        description="This will move the employee from probation to active status. A confirmation date will be recorded."
        confirmLabel="Confirm"
        onConfirm={handleConfirm}
        isPending={isPending}
        error={dialogError}
      />

      <TerminateDialog
        open={dialog === "terminate"}
        onClose={() => setDialog(null)}
        onConfirm={handleTerminate}
        isPending={isPending}
        error={dialogError}
      />
    </>
  );
}
