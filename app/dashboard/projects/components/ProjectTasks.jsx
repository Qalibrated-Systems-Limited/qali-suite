"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ListTree,
  Plus,
  Trash2,
  Loader2,
  ChevronRight,
  Pencil,
  CircleDashed,
  CircleDot,
  CircleCheckBig,
} from "lucide-react";
import {
  createProjectTask,
  updateProjectTask,
  setProjectTaskProgress,
  deleteProjectTask,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";

/**
 * The work breakdown — 0071.
 *
 * The percentage on a SUMMARY row is not editable and is not stored: it is the
 * weighted roll-up of the leaves beneath it, and the database refuses to store
 * one on a task with subtasks. That is the point of the whole table — a
 * manager typing 90% onto a summary line whose children are at 20% is the
 * commonest way a WBS lies.
 *
 * `rolledUpProgress` is what to render on every row. `progressPercent` is the
 * stored leaf value and is always 0 on a parent.
 */
const STATUS_STYLES = {
  todo: { label: "To do", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "In progress", className: "bg-blue-500/10 text-blue-600" },
  blocked: { label: "Blocked", className: "bg-amber-500/10 text-amber-600" },
  done: { label: "Done", className: "bg-emerald-500/10 text-emerald-600" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground line-through" },
};

function StatusIcon({ status }) {
  if (status === "done") return <CircleCheckBig className="h-4 w-4 text-emerald-500" />;
  if (status === "in_progress") return <CircleDot className="h-4 w-4 text-blue-500" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export default function ProjectTasks({
  projectId,
  tasks = [],
  progress,
  assignees = [],
  canManage = false,
  readOnly = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [addingUnder, setAddingUnder] = useState(null); // null = closed, "" = root
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("");
  const [assignee, setAssignee] = useState("");

  const editable = canManage && !readOnly;

  function resetForm() {
    setTitle("");
    setHours("");
    setAssignee("");
    setAddingUnder(null);
    setEditing(null);
  }

  function startEditing(task) {
    setAddingUnder(null);
    setTitle(task.title);
    setHours(task.estimatedHours ?? "");
    setAssignee(task.assignedPartyId ?? "");
    setEditing(task.id);
  }

  function handleSaveEdit(task) {
    if (!title.trim()) {
      toast.error("A task needs a title");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("title", title.trim());
      // Every field the schema takes has to go back, because the action
      // replaces the plan rather than patching it — a missing key would clear
      // the value it stands for.
      if (task.parentTaskId) fd.set("parentTaskId", task.parentTaskId);
      if (hours !== "" && hours !== null) fd.set("estimatedHours", String(hours));
      if (task.weight) fd.set("weight", String(task.weight));
      if (task.plannedStart) fd.set("plannedStart", task.plannedStart);
      if (task.plannedEnd) fd.set("plannedEnd", task.plannedEnd);
      if (task.costCodeId) fd.set("costCodeId", task.costCodeId);
      fd.set("sortOrder", String(task.sortOrder ?? 0));
      if (assignee) {
        const person = assignees.find((a) => a._id === assignee);
        fd.set("assignedPartyId", assignee);
        // The pair CHECK: an id with no name is a link nothing can render.
        fd.set("assignedName", person?.name ?? "");
      }

      const res = await updateProjectTask(task.id, null, fd);
      if (res?.success) {
        toast.success("Task updated");
        resetForm();
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to update");
      }
    });
  }

  function handleAdd(parentTaskId) {
    if (!title.trim()) {
      toast.error("A task needs a title");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("title", title.trim());
      if (parentTaskId) fd.set("parentTaskId", parentTaskId);
      if (hours) fd.set("estimatedHours", hours);
      const res = await createProjectTask(null, fd);
      if (res?.success) {
        toast.success("Task added");
        resetForm();
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to add task");
      }
    });
  }

  function handleProgress(task, value) {
    startTransition(async () => {
      const res = await setProjectTaskProgress(task.id, { progressPercent: value });
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  function handleStatus(task, status) {
    startTransition(async () => {
      const res = await setProjectTaskProgress(task.id, { status });
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  function handleDelete(task) {
    startTransition(async () => {
      const res = await deleteProjectTask(task.id);
      if (res.success) toast.success("Task deleted");
      else toast.error(res.error);
    });
  }

  /** One form, two jobs — `task` null means "add under parentTaskId". */
  const taskForm = (parentTaskId, task = null) => (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={parentTaskId && !task ? "Subtask title" : "Task title"}
        className="h-8 flex-1 min-w-[12rem]"
        onKeyDown={(e) =>
          e.key === "Enter" && (task ? handleSaveEdit(task) : handleAdd(parentTaskId))
        }
      />
      <Input
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        placeholder="Est. hours"
        inputMode="decimal"
        className="h-8 w-28"
      />
      {assignees.length > 0 && (
        <select
          aria-label="Assign to"
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a._id} value={a._id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => (task ? handleSaveEdit(task) : handleAdd(parentTaskId))}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : task ? (
          "Save"
        ) : (
          "Add"
        )}
      </Button>
      <Button size="sm" variant="ghost" onClick={resetForm}>
        Cancel
      </Button>
    </div>
  );

  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ListTree className="h-5 w-5 text-muted-foreground shrink-0" />
          <h3 className="font-semibold truncate">Work breakdown</h3>
          {progress?.source === "tasks" && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {progress.doneCount}/{progress.taskCount} done · {progress.percent}%
            </Badge>
          )}
          {/* The project's headline percentage now comes from the bill, so this
              card must not imply the WBS is where it came from — 0080. */}
          {progress?.source === "measured" && (
            <Badge variant="outline" className="text-xs shrink-0 font-normal">
              {progress.doneCount}/{progress.taskCount} done · project progress
              is measured from the bill
            </Badge>
          )}
        </div>
        {editable && addingUnder === null && (
          <Button size="sm" variant="outline" onClick={() => setAddingUnder("")}>
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Task</span>
          </Button>
        )}
      </div>

      {tasks.length === 0 && addingUnder === null && (
        <p className="text-sm text-muted-foreground">
          No tasks yet. While there are none, this project reports the percentage
          somebody typed on it; add a task and the number becomes the weighted
          progress of the work itself.
        </p>
      )}

      {addingUnder === "" && editable && taskForm(null)}

      <div className="divide-y">
        {tasks.map((task) => {
          const isSummary = task.childCount > 0;
          const style = STATUS_STYLES[task.status] ?? STATUS_STYLES.todo;
          if (editing === task.id && editable) {
            return (
              <div
                key={task.id}
                className="py-2"
                style={{ paddingLeft: `${(task.depth ?? 0) * 1.25}rem` }}
              >
                {taskForm(task.parentTaskId, task)}
              </div>
            );
          }

          return (
            <div key={task.id} className="py-2">
              <div
                className="flex items-start gap-2"
                style={{ paddingLeft: `${(task.depth ?? 0) * 1.25}rem` }}
              >
                <div className="pt-0.5 shrink-0">
                  {isSummary ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <StatusIcon status={task.status} />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm ${isSummary ? "font-medium" : ""} ${
                        task.status === "cancelled" ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {task.title}
                    </span>
                    <Badge variant="secondary" className={`text-xs ${style.className}`}>
                      {style.label}
                    </Badge>
                    {task.assignedName && (
                      <span className="text-xs text-muted-foreground">
                        {task.assignedName}
                      </span>
                    )}
                    {task.estimatedHours > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {task.estimatedHours}h
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 max-w-xs bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          task.rolledUpProgress === 100 ? "bg-emerald-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${task.rolledUpProgress}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                      {task.rolledUpProgress}%
                    </span>
                    {isSummary && (
                      <span className="text-xs text-muted-foreground">
                        from {task.childCount} subtask{task.childCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>

                {editable && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* A summary takes its number from its children, so there is
                        nothing here to set. */}
                    {!isSummary && task.status !== "cancelled" && (
                      <select
                        aria-label={`Progress for ${task.title}`}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={task.progressPercent}
                        disabled={isPending}
                        onChange={(e) => handleProgress(task, Number(e.target.value))}
                      >
                        {[0, 10, 25, 50, 75, 90, 100].map((v) => (
                          <option key={v} value={v}>
                            {v}%
                          </option>
                        ))}
                      </select>
                    )}
                    {!isSummary && task.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleStatus(task, "cancelled")}
                        title="Cancel this task"
                      >
                        ✕
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => startEditing(task)}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        resetForm();
                        setAddingUnder(task.id);
                      }}
                      title="Add a subtask"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    {task.childCount === 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleDelete(task)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {addingUnder === task.id && editable && (
                <div style={{ paddingLeft: `${((task.depth ?? 0) + 1) * 1.25}rem` }}>
                  {taskForm(task.id)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
