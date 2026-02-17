"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Loader2, AlertCircle, UserPlus } from "lucide-react";
import { quickCreateParty } from "@/app/mongodb/actions/party-actions";

export default function QuickCreatePartyDialog({
  partyType = "customer",
  onPartyCreated,
  children,
}) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  const label = partyType === "supplier" ? "Supplier" : "Customer";

  async function handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsPending(true);
    setError("");

    const formData = new FormData(e.target);
    formData.set("type", partyType);
    const result = await quickCreateParty(formData);

    if (result.success) {
      onPartyCreated(result.party);
      setOpen(false);
      e.target.reset();
    } else {
      setError(result.error);
    }
    setIsPending(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError("");
      }}
    >
      <DialogTrigger asChild>
        {children || (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 border-dashed border-border text-muted-foreground hover:text-yellow-500 hover:border-yellow-500/50"
            title={`Quick add ${label.toLowerCase()}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-yellow-500" />
            Quick Add {label}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add a new {label.toLowerCase()} without leaving the form
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert
              variant="destructive"
              className="bg-red-500/10 border-red-500/20"
            >
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <AlertDescription className="text-red-600 dark:text-red-400">
                {error}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label className="text-foreground">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              name="name"
              placeholder={`${label} name`}
              required
              className="bg-background border-border"
              disabled={isPending}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Phone</Label>
            <Input
              name="phone"
              type="tel"
              placeholder="0712 345 678"
              className="bg-background border-border"
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Email</Label>
            <Input
              name="email"
              type="email"
              placeholder={`${label.toLowerCase()}@example.com`}
              className="bg-background border-border"
              disabled={isPending}
            />
          </div>

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
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add {label}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
