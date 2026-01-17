"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, X } from "lucide-react";
import {
  linkUserToParty,
  unlinkUserFromParty,
} from "@/app/mongodb/actions/link-user-action";
import { toast } from "sonner";

export function LinkUserDialog({ party, users }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [state, formAction, isPending] = useActionState(linkUserToParty, {});

  // Handle success
  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
      setOpen(false);
      router.refresh();
    }
  }, [state.success, state.message, router]);

  // Handle errors
  useEffect(() => {
    if (state.errors?._form) {
      toast.error(state.errors._form[0]);
    }
  }, [state.errors]);

  // Handle unlink
  const handleUnlink = async () => {
    if (!confirm("Are you sure you want to unlink this user?")) return;

    const result = await unlinkUserFromParty(party._id);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.errors._form[0]);
    }
  };

  // Get linked user
  const linkedUser = users.find((u) => u._id === party.userId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {party.userId ? (
          <Button variant="outline" size="sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Change User
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Link User
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {party.userId ? "Change Linked User" : "Link User to Employee"}
          </DialogTitle>
          <DialogDescription>
            Link this employee party to a user account. This allows the user to
            submit expense claims and travel advances.
          </DialogDescription>
        </DialogHeader>

        {/* Show currently linked user */}
        {party.userId && linkedUser && (
          <div className="p-3 bg-muted rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Currently Linked</p>
                <p className="text-sm text-muted-foreground">
                  {linkedUser.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {linkedUser.email}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUnlink}
                className="text-destructive hover:text-destructive"
              >
                <X className="w-4 h-4 mr-1" />
                Unlink
              </Button>
            </div>
          </div>
        )}

        {/* Link form */}
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="partyId" value={party._id} />

          <div className="space-y-2">
            <Label htmlFor="userId">
              Select User <span className="text-destructive">*</span>
            </Label>
            <Select
              name="userId"
              value={selectedUserId}
              onValueChange={setSelectedUserId}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a user..." />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user._id} value={user._id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {user.email} • {user.role}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.errors?.userId && (
              <p className="text-sm text-destructive">
                {state.errors.userId[0]}
              </p>
            )}
          </div>

          {/* General error */}
          {state.errors?._form && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              {state.errors._form[0]}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !selectedUserId}
              className="bg-yellow-500 text-black hover:bg-yellow-600"
            >
              {isPending ? "Linking..." : "Link User"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
