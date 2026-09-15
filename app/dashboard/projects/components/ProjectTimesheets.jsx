"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Clock, Plus, Check, X, Loader2, Trash2 } from "lucide-react";
import {
  logProjectTime,
  setProjectTimesheetStatus,
  approveProjectTimesheets,
  deleteProjectTimesheet,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";

/**
 * Time booked to this job — 0089.
 *
 * The screen that closes the module's largest cost hole: a contractor's own
 * labour reached the P&L through payroll and reached no project at all, so a
 * labour-heavy job reported a margin it did not have.
 *
 * A SUPPLIER'S LINE SHOWS A DASH, NOT A ZERO, and that is deliberate. Their
 * cost arrives on a bill carrying the project and is already counted; charging
 * the timesheet too would bill the job twice for the same work. A zero would
 * read as "this was free", which is the wrong sentence entirely.
 *
 * The cost is never typed here. It is the database's — see 0089 decision 4 —
 * so what this form sends is who, when and how long.
 */

const UNITS = ["hour", "day"];

const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/10 text-amber-600",
  approved: "bg-emerald-500/10 text-emerald-600",
  rejected: "bg-rose-500/10 text-rose-600",
};

const money = (n) =>
  `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ProjectTimesheets({
  projectId,
  entries = [],
  summary,
  members = [],
  tasks = [],
  canManage,
  readOnly,
}) {
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [assignmentId, setAssignmentId] = useState("");
  const [workDate, setWorkDate] = useState(today);
  const [quantity, setQuantity] = useState("8");
  const [unit, setUnit] = useState("hour");
  const [taskId, setTaskId] = useState("");
  const [notes, setNotes] = useState("");

  // Only somebody currently on the roster can be booked to the job — the
  // roster is what carries the rate, so it is also what decides the cost.
  const roster = members.filter((m) => m.status === "active");
  const awaiting = entries.filter((e) => e.status === "submitted").length;

  function resetForm() {
    setAssignmentId("");
    setWorkDate(today());
    setQuantity("8");
    setUnit("hour");
    setTaskId("");
    setNotes("");
    setAdding(false);
  }

  function handleLog() {
    if (!assignmentId) {
      toast.error("Choose who the time is for");
      return;
    }
    startTransition(async () => {
      const res = await logProjectTime(projectId, {
        assignmentId,
        workDate,
        quantity: Number(quantity),
        unit,
        taskId: taskId || null,
        notes,
      });
      if (res.success) {
        toast.success(res.message || "Time logged");
        resetForm();
      } else {
        toast.error(res.error || "Could not log the time");
      }
    });
  }

  function handleStatus(id, status) {
    startTransition(async () => {
      const res = await setProjectTimesheetStatus(id, status);
      if (res.success) toast.success(res.message);
      else toast.error(res.error || "Could not update the entry");
    });
  }

  // A week is approved in one statement rather than a row at a time: twenty
  // round trips is twenty overbooking triggers, and a partial failure halfway
  // leaves a week half-approved.
  function handleApproveAll() {
    const ids = entries.filter((e) => e.status === "submitted").map((e) => e._id);
    if (!ids.length) return;
    startTransition(async () => {
      const res = await approveProjectTimesheets(projectId, ids);
      if (res.success) toast.success(res.message);
      else toast.error(res.error || "Could not approve the entries");
    });
  }

  function handleDelete(id) {
    startTransition(async () => {
      const res = await deleteProjectTimesheet(id);
      if (res.success) toast.success(res.message);
      else toast.error(res.error || "Could not remove the entry");
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2.5 bg-sky-500/10">
            <Clock className="h-5 w-5 text-sky-500" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Time</h2>
            <p className="text-xs text-muted-foreground">
              Labour booked to this job
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && !readOnly && awaiting > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleApproveAll}
              disabled={isPending}
            >
              <Check className="h-4 w-4 mr-1" /> Approve {awaiting}
            </Button>
          )}
          {canManage && !readOnly && !adding && roster.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-1" /> Log time
            </Button>
          )}
        </div>
      </div>

      {/*
        NOBODY ON THE ROSTER — say so, instead of hiding the button.

        `roster.length > 0` already gated "Log time", so a project with an
        empty roster showed a card headed "Time / Labour booked to this job"
        with no control and no explanation. The reason is real — a timesheet
        line needs an assignment, because the assignment carries the rate that
        decides the cost — but an unexplained missing button is a dead end, and
        the way out was to leave for the project record and scroll to Team.

        The roster now sits directly below this card on the Timesheets page, so
        the way out is a scroll rather than a journey.
      */}
      {canManage && !readOnly && roster.length === 0 && (
        <div className="mb-4 rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm font-medium">Nobody is on this project yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Time is booked against a team member, because their rate is what
            decides the cost. Add people to the team below, then log time here.
          </p>
        </div>
      )}

      {summary && summary.entries > 0 && (
        <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Labour cost</p>
            <p className="text-sm font-semibold">{money(summary.costIncurred)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Awaiting approval</p>
            <p className="text-sm font-semibold">{money(summary.costCommitted)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Days</p>
            <p className="text-sm font-semibold">
              {summary.days.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Hours</p>
            <p className="text-sm font-semibold">
              {summary.hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}

      {canManage && adding && (
        <div className="mb-4 rounded-lg border p-3 grid gap-2 sm:grid-cols-[1.4fr_1fr_auto_1.2fr_auto]">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={assignmentId}
            onChange={(e) => setAssignmentId(e.target.value)}
          >
            <option value="">Who…</option>
            {roster.map((m) => (
              <option key={m._id} value={m._id}>
                {m.party?.name}
                {m.party?.type && m.party.type !== "employee"
                  ? ` (${m.party.type})`
                  : ""}
              </option>
            ))}
          </select>
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
          <div className="flex gap-1">
            <Input
              type="number"
              min="0"
              step="0.25"
              className="w-20"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}s
                </option>
              ))}
            </select>
          </div>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">No task</option>
            {tasks.map((t) => (
              <option key={t._id} value={t._id}>
                {t.title}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <Button size="sm" onClick={handleLog} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={resetForm}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
          <Input
            className="sm:col-span-5"
            placeholder="What was done (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {roster.length === 0
            ? "Assign somebody to the project before booking time to it."
            : "No time booked to this job yet."}
        </p>
      ) : (
        <ul className="divide-y">
          {entries.map((e) => (
            <li key={e._id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {e.partyName}
                  <span className="text-muted-foreground font-normal">
                    {" · "}
                    {e.quantity} {e.unit}
                    {e.quantity === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {e.workDate}
                  {e.notes ? ` · ${e.notes}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm tabular-nums">
                  {/* Never a zero for a subcontractor: their cost is on a
                      bill, and a dash says "counted elsewhere". */}
                  {e.cost === null ? (
                    <span
                      className="text-muted-foreground"
                      title="Invoiced, not costed here — this is a supplier or a fixed-price engagement."
                    >
                      —
                    </span>
                  ) : (
                    money(e.cost)
                  )}
                </span>
                <Badge
                  variant="secondary"
                  className={`text-xs ${STATUS_STYLES[e.status] ?? ""}`}
                >
                  {e.status}
                </Badge>
                {canManage && !readOnly && (
                  <div className="flex items-center gap-1">
                    {e.status === "draft" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleStatus(e._id, "submitted")}
                        disabled={isPending}
                      >
                        Submit
                      </Button>
                    )}
                    {e.status === "submitted" && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleStatus(e._id, "approved")}
                          disabled={isPending}
                          aria-label={`Approve ${e.partyName}'s time`}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleStatus(e._id, "rejected")}
                          disabled={isPending}
                          aria-label={`Reject ${e.partyName}'s time`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {/* An approved line is rejected, never deleted — it has
                        been counted, and a hole in a week proves nothing. */}
                    {e.status !== "approved" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleDelete(e._id)}
                        disabled={isPending}
                        aria-label={`Remove ${e.partyName}'s entry`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
