"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateCompanyPlan,
  updateCompanyStatus,
  extendTrial,
  renewSubscription,
  cancelSubscription,
} from "@/app/mongodb/actions/subscription-actions";
import { DEFAULT_PLANS } from "@/lib/plans";

function planLabel(p) {
  const seats = p.maxUsers === -1 ? "Unlimited" : `${p.maxUsers} users`;
  return `${p.label} (${seats})`;
}

function StatusMessage({ state }) {
  if (!state) return null;
  if (state.success) {
    return <p className="text-sm text-green-600 mt-2">{state.message}</p>;
  }
  if (state.error) {
    return <p className="text-sm text-red-600 mt-2">{state.error}</p>;
  }
  return null;
}

export default function SubscriptionForms({ companyId, currentPlan, currentStatus }) {
  const [planState, planAction, planPending] = useActionState(updateCompanyPlan, null);
  const [statusState, statusAction, statusPending] = useActionState(updateCompanyStatus, null);
  const [trialState, trialAction, trialPending] = useActionState(extendTrial, null);
  const [renewState, renewAction, renewPending] = useActionState(renewSubscription, null);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelSubscription, null);
  const [cancelImmediate, setCancelImmediate] = useState(false);
  const [activateOnUpgrade, setActivateOnUpgrade] = useState(true);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Change Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Change Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={planAction} className="space-y-4">
            <input type="hidden" name="companyId" value={companyId} />
            <input
              type="hidden"
              name="activate"
              value={activateOnUpgrade ? "true" : "false"}
            />
            <div className="space-y-2">
              <Label htmlFor="plan">New Plan</Label>
              <Select name="plan" defaultValue={currentPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_PLANS.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {planLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {planState?.requiresForce && (
                <p className="text-xs text-orange-600">
                  Override: pass force=true to proceed despite seat overage.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="plan-months">Activation period (months)</Label>
                <Input
                  id="plan-months"
                  name="months"
                  type="number"
                  min="1"
                  max="60"
                  defaultValue="1"
                  disabled={!activateOnUpgrade}
                />
              </div>
              <div className="space-y-2">
                <Label className="invisible">spacer</Label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
                  <Checkbox
                    checked={activateOnUpgrade}
                    onCheckedChange={(v) => setActivateOnUpgrade(!!v)}
                  />
                  Activate + start period
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="plan-reason">Reason</Label>
              <Input
                id="plan-reason"
                name="reason"
                placeholder="Reason for plan change"
                required
              />
            </div>

            <p className="text-xs text-muted-foreground">
              When upgrading from <strong>trial / free / expired</strong> to a
              paid plan with "Activate" on, the company is moved to
              <strong> active</strong> and the billing period is set to the
              chosen number of months. Switching to <strong>free</strong>
              clears the period (free is permanent).
            </p>

            <Button
              type="submit"
              disabled={planPending}
              className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
            >
              {planPending ? "Updating..." : "Update Plan"}
            </Button>
            <StatusMessage state={planState} />
          </form>
        </CardContent>
      </Card>

      {/* Change Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Change Status</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={statusAction} className="space-y-4">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="space-y-2">
              <Label htmlFor="status">New Status</Label>
              <Select name="status" defaultValue={currentStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-reason">Reason</Label>
              <Input
                id="status-reason"
                name="reason"
                placeholder="Reason for status change"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={statusPending}
              className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
            >
              {statusPending ? "Updating..." : "Update Status"}
            </Button>
            <StatusMessage state={statusState} />
          </form>
        </CardContent>
      </Card>

      {/* Renew Subscription */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Renew Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={renewAction} className="space-y-4">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="months">Months</Label>
                <Input
                  id="months"
                  name="months"
                  type="number"
                  min="1"
                  max="60"
                  defaultValue="1"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="renew-reason">Reason</Label>
                <Input
                  id="renew-reason"
                  name="reason"
                  placeholder="Payment received, ref #..."
                  required
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sets status to <strong>active</strong> and extends the billing
              period. Chains from the current period end if still in the future.
            </p>
            <Button
              type="submit"
              disabled={renewPending}
              className="bg-yellow-500 text-black hover:bg-yellow-600"
            >
              {renewPending ? "Renewing..." : "Renew Subscription"}
            </Button>
            <StatusMessage state={renewState} />
          </form>
        </CardContent>
      </Card>

      {/* Extend Trial */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Extend Trial</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={trialAction} className="space-y-4">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="days">Days to Extend</Label>
                <Input
                  id="days"
                  name="days"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue="14"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trial-reason">Reason</Label>
                <Input
                  id="trial-reason"
                  name="reason"
                  placeholder="Reason for trial extension"
                  required
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={trialPending}
              className="bg-yellow-500 text-black hover:bg-yellow-600"
            >
              {trialPending ? "Extending..." : "Extend Trial"}
            </Button>
            <StatusMessage state={trialState} />
          </form>
        </CardContent>
      </Card>

      {/* Cancel Subscription */}
      <Card className="md:col-span-2 border-destructive/30">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">
            Cancel Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={cancelAction} className="space-y-4">
            <input type="hidden" name="companyId" value={companyId} />
            <input
              type="hidden"
              name="immediate"
              value={cancelImmediate ? "true" : "false"}
            />
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Input
                id="cancel-reason"
                name="reason"
                placeholder="Reason for cancellation"
                required
              />
            </div>
            <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <Checkbox
                checked={cancelImmediate}
                onCheckedChange={(v) => setCancelImmediate(!!v)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <p className="font-medium">Cancel immediately</p>
                <p className="text-xs text-muted-foreground">
                  Off (default): the company keeps access until{" "}
                  <code className="font-mono">currentPeriodEnd</code> — industry
                  standard "cancel at period end". On: clears the period now,
                  user-limit clamps to free plan immediately.
                </p>
              </div>
            </label>
            <Button
              type="submit"
              disabled={cancelPending}
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/5"
            >
              {cancelPending ? "Cancelling..." : "Cancel Subscription"}
            </Button>
            <StatusMessage state={cancelState} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
