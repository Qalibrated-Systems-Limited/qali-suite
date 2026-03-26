"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/app/mongodb/actions/subscription-actions";

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
            <div className="space-y-2">
              <Label htmlFor="plan">New Plan</Label>
              <Select name="plan" defaultValue={currentPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free (2 users)</SelectItem>
                  <SelectItem value="starter">Starter (5 users)</SelectItem>
                  <SelectItem value="professional">Professional (20 users)</SelectItem>
                  <SelectItem value="enterprise">Enterprise (Unlimited)</SelectItem>
                </SelectContent>
              </Select>
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
    </div>
  );
}
