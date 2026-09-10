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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Mail,
  Check,
  ChevronDown,
} from "lucide-react";
import { sendInvitePg } from "@/app/db/actions/invite-actions";
import { userRolesMapping, cn } from "@/lib/utils";

export default function InviteUserDialog({ isSuperAdmin = false }) {
  const [open, setOpen] = useState(false);
  const [state, dispatch, isPending] = useActionState(sendInvitePg, {});

  // Role + Company are now searchable comboboxes (Popover + Command),
  // so their value lives in local state and is submitted via a hidden
  // <input> rather than the Select's native form integration.
  const [role, setRole] = useState("Employee");
  const [rolePopoverOpen, setRolePopoverOpen] = useState(false);

  // Filter roles: Admin can't invite Admin/SuperAdmin
  const availableRoles = isSuperAdmin
    ? userRolesMapping
    : userRolesMapping.filter(
        (r) => r.value !== "SuperAdmin" && r.value !== "Admin"
      );

  const selectedRole = availableRoles.find((r) => r.value === role);

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
            Send an email invitation to add a new user
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

            {/* Role — searchable combobox so the 13-item list is fast
                to navigate. Hidden input below carries the selected
                value into the form action. */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Role
              </label>
              <input type="hidden" name="role" value={role} />
              <Popover
                open={rolePopoverOpen}
                onOpenChange={setRolePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={rolePopoverOpen}
                    className={cn(
                      "w-full justify-between font-normal bg-background border-border text-foreground",
                      !selectedRole && "text-muted-foreground",
                    )}
                  >
                    {selectedRole?.label || "Select a role"}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                >
                  <Command>
                    <CommandInput placeholder="Search roles..." />
                    <CommandList>
                      <CommandEmpty>No role found.</CommandEmpty>
                      <CommandGroup>
                        {availableRoles.map(({ label, value }) => (
                          <CommandItem
                            key={value}
                            value={label}
                            onSelect={() => {
                              setRole(value);
                              setRolePopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                role === value ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="text-sm">{label}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* A company PICKER was here, for SuperAdmins. It posted a hidden
                `companyId` that `createInvite` never read — the action parses
                only email, role and partyId, and takes its company from
                withAuthorizedTenant, i.e. the switcher. Choosing a tenant here
                appeared to work and invited into whichever company you happened
                to be in. Switch company first; the invite follows the switcher,
                as every other tenant-scoped write does. */}

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
