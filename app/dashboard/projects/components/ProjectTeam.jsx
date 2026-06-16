"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, X, Loader2 } from "lucide-react";
import {
  assignPartyToProject,
  removePartyFromProject,
} from "@/app/mongodb/actions/project-assignment-actions";
import { toast } from "sonner";

const RATE_UNITS = ["day", "hour", "month", "fixed"];

// The project labor roster. Assigning a party posts no cost — actual cost still
// flows through expenses/bills tagged to the party + project. This is the
// operational "who's on the job" view (works without the HR module).
export default function ProjectTeam({ projectId, members = [], parties = [], canManage }) {
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [role, setRole] = useState("");
  const [rateAmount, setRateAmount] = useState("");
  const [rateUnit, setRateUnit] = useState("day");

  // Parties already on the roster can't be added again.
  const assigned = new Set(members.map((m) => m.party?.partyId));
  const available = parties.filter((p) => !assigned.has(p._id));

  function resetForm() {
    setPartyId("");
    setRole("");
    setRateAmount("");
    setRateUnit("day");
    setAdding(false);
  }

  function handleAdd() {
    if (!partyId) {
      toast.error("Select a person to assign");
      return;
    }
    startTransition(async () => {
      const rate = rateAmount ? { amount: Number(rateAmount), unit: rateUnit } : undefined;
      const res = await assignPartyToProject(projectId, { partyId, role, rate });
      if (res.success) {
        toast.success("Added to project team");
        resetForm();
      } else {
        toast.error(res.error || "Failed to add member");
      }
    });
  }

  function handleRemove(assignmentId, name) {
    startTransition(async () => {
      const res = await removePartyFromProject(assignmentId);
      if (res.success) toast.success(`Removed ${name}`);
      else toast.error(res.error || "Failed to remove member");
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2.5 bg-violet-500/10">
            <Users className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Team</h2>
            <p className="text-xs text-muted-foreground">
              People assigned to this project
            </p>
          </div>
        </div>
        {canManage && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Assign
          </Button>
        )}
      </div>

      {/* Add-member inline form */}
      {canManage && adding && (
        <div className="mb-4 rounded-lg border p-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
          >
            <option value="">Select person…</option>
            {available.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} {p.type ? `(${p.type})` : ""}
              </option>
            ))}
          </select>
          <Input
            placeholder="Role (e.g. Foreman)"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <div className="flex gap-1">
            <Input
              type="number"
              min="0"
              placeholder="Rate"
              className="w-24"
              value={rateAmount}
              onChange={(e) => setRateAmount(e.target.value)}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={rateUnit}
              onChange={(e) => setRateUnit(e.target.value)}
            >
              {RATE_UNITS.map((u) => (
                <option key={u} value={u}>/{u}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1">
            <Button size="sm" onClick={handleAdd} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Roster */}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No one assigned yet.
        </p>
      ) : (
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m._id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{m.party?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {m.role || "—"}
                  {m.rate?.amount
                    ? ` · KES ${m.rate.amount.toLocaleString()}/${m.rate.unit}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary" className="text-xs">
                  {m.party?.type || "employee"}
                </Badge>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleRemove(m._id, m.party?.name)}
                    disabled={isPending}
                    aria-label={`Remove ${m.party?.name}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
