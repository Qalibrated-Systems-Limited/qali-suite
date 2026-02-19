"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ArrowLeft, Loader2, Save, ChevronsUpDown, Check } from "lucide-react";
import {
  createProject,
  updateProject,
} from "@/app/mongodb/actions/project-actions";
import { cn } from "@/lib/utils";

function PartyCombobox({ value, onValueChange, parties, placeholder, label }) {
  const [open, setOpen] = useState(false);
  const selected = value ? parties.find((p) => p._id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate">{selected.name}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-75 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label}...`} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onValueChange("", "");
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <span className="italic">Clear</span>
                </CommandItem>
              )}
              {parties.map((party) => (
                <CommandItem
                  key={party._id}
                  value={party.name}
                  onSelect={() => {
                    onValueChange(party._id, party.name);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === party._id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {party.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FieldError({ errors, field }) {
  if (!errors?.[field]) return null;
  return <p className="text-sm text-red-500">{errors[field][0]}</p>;
}

export default function ProjectForm({
  clients = [],
  users = [],
  parentProjects = [],
  project = null,
}) {
  const isEdit = !!project;

  const action = isEdit ? updateProject.bind(null, project._id) : createProject;

  const [state, formAction, isPending] = useActionState(action, null);

  const [clientPartyId, setClientPartyId] = useState(
    project?.client?.partyId || "",
  );
  const [clientName, setClientName] = useState(project?.client?.name || "");
  const [pmUserId, setPmUserId] = useState(
    project?.projectManager?.userId || "",
  );
  const [pmName, setPmName] = useState(project?.projectManager?.name || "");
  const [parentProjectId, setParentProjectId] = useState(
    project?.parentProjectId || "",
  );
  const [, setParentProjectName] = useState("");

  const errors = state?.errors;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={
              isEdit
                ? `/dashboard/projects/${project._id}`
                : "/dashboard/projects"
            }
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {isEdit ? "Edit Project" : "Create Project"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isEdit
              ? "Update project details"
              : "Set up a new project to track costs and profitability"}
          </p>
        </div>
      </div>

      {/* Form */}
      <form action={formAction}>
        {/* Hidden fields for combobox values */}
        <input type="hidden" name="clientPartyId" value={clientPartyId} />
        <input type="hidden" name="clientName" value={clientName} />
        <input type="hidden" name="projectManagerUserId" value={pmUserId} />
        <input type="hidden" name="projectManagerName" value={pmName} />
        <input type="hidden" name="parentProjectId" value={parentProjectId} />

        {/* Form-level errors */}
        {errors?._form && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 mb-4">
            {errors._form.map((error, i) => (
              <p key={i} className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            ))}
          </div>
        )}

        <Card className="p-6 space-y-6">
          {/* Project Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Project Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g., Nairobi Office Renovation"
              defaultValue={project?.name || state?.values?.name || ""}
              required
            />
            <FieldError errors={errors} field="name" />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Brief description of the project scope..."
              rows={3}
              defaultValue={
                project?.description || state?.values?.description || ""
              }
            />
            <FieldError errors={errors} field="description" />
          </div>

          {/* Client and PM */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Client</Label>
              <PartyCombobox
                value={clientPartyId}
                onValueChange={(id, name) => {
                  setClientPartyId(id);
                  setClientName(name);
                }}
                parties={clients}
                placeholder="Select client..."
                label="clients"
              />
            </div>

            <div className="space-y-2">
              <Label>Project Manager</Label>
              <PartyCombobox
                value={pmUserId}
                onValueChange={(id, name) => {
                  setPmUserId(id);
                  setPmName(name);
                }}
                parties={users.map((u) => ({
                  _id: u._id,
                  name: `${u.name} (${u.role})`,
                }))}
                placeholder="Select PM..."
                label="users"
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                defaultValue={
                  project?.startDate
                    ? new Date(project.startDate).toISOString().split("T")[0]
                    : state?.values?.startDate || ""
                }
              />
              <FieldError errors={errors} field="startDate" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate">Expected End Date</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                defaultValue={
                  project?.endDate
                    ? new Date(project.endDate).toISOString().split("T")[0]
                    : state?.values?.endDate || ""
                }
              />
              <FieldError errors={errors} field="endDate" />
            </div>
          </div>

          {/* Budget and Priority */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="budgetAmount">Budget Amount (KES)</Label>
              <Input
                id="budgetAmount"
                name="budgetAmount"
                type="number"
                min="0"
                step="1"
                placeholder="500000"
                defaultValue={
                  project?.budget?.amount || state?.values?.budgetAmount || ""
                }
              />
              <FieldError errors={errors} field="budgetAmount" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                name="priority"
                defaultValue={
                  project?.priority || state?.values?.priority || "normal"
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <FieldError errors={errors} field="priority" />
            </div>
          </div>

          {/* Contract & Billing */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contractValue">Contract Value (KES)</Label>
              <Input
                id="contractValue"
                name="contractValue"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 2000000"
                defaultValue={
                  project?.contractValue || state?.values?.contractValue || ""
                }
              />
              <p className="text-xs text-muted-foreground">
                Total contract value agreed with client
              </p>
              <FieldError errors={errors} field="contractValue" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingModel">Billing Model</Label>
              <Select
                name="billingModel"
                defaultValue={
                  project?.billingModel || state?.values?.billingModel || ""
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select billing model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed Price</SelectItem>
                  <SelectItem value="milestone">Milestone</SelectItem>
                  <SelectItem value="time_material">Time & Material</SelectItem>
                </SelectContent>
              </Select>
              <FieldError errors={errors} field="billingModel" />
            </div>
          </div>

          {/* Parent Project & Progress */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Parent Project</Label>
              <PartyCombobox
                value={parentProjectId}
                onValueChange={(id, name) => {
                  setParentProjectId(id);
                  setParentProjectName(name);
                }}
                parties={parentProjects.map((p) => ({
                  _id: p._id,
                  name: `${p.projectNumber} — ${p.name}`,
                }))}
                placeholder="None (standalone)"
                label="projects"
              />
              <p className="text-xs text-muted-foreground">
                Optional — group as a subproject under a parent
              </p>
            </div>

            {isEdit && (
              <div className="space-y-2">
                <Label htmlFor="progressPercent">Progress (%)</Label>
                <Input
                  id="progressPercent"
                  name="progressPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="0"
                  defaultValue={
                    project?.progressPercent ||
                    state?.values?.progressPercent ||
                    "0"
                  }
                />
                <FieldError errors={errors} field="progressPercent" />
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              name="tags"
              placeholder="construction, mombasa, urgent (comma-separated)"
              defaultValue={
                project?.tags?.join(", ") || state?.values?.tags || ""
              }
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated tags for categorization
            </p>
            <FieldError errors={errors} field="tags" />
          </div>

          <input type="hidden" name="budgetCurrency" value="KES" />
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" asChild>
            <Link
              href={
                isEdit
                  ? `/dashboard/projects/${project._id}`
                  : "/dashboard/projects"
              }
            >
              Cancel
            </Link>
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isEdit ? "Updating..." : "Creating..."}
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                {isEdit ? "Update Project" : "Create Project"}
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}
