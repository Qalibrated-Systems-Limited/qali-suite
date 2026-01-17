"use client";

// /components/categories/CategoryForm.jsx
// Client component for form state management with useActionState

import { useActionState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import Link from "next/link";

import {
  createCategory,
  updateCategory,
} from "../../../mongodb/actions/category-actions";

export default function CategoryForm({ category, parentOptions = [] }) {
  const isEditing = !!category;

  // Bind categoryId for update action
  const boundUpdateAction = category
    ? updateCategory.bind(null, category._id)
    : null;

  const [state, formAction, isPending] = useActionState(
    isEditing ? boundUpdateAction : createCategory,
    null
  );

  // Read errors directly from state (no useEffect needed)
  const errors = state?.error || {};
  const formError = errors._form?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {/* Form-level error */}
      {formError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Category Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g., Loadcells"
          defaultValue={category?.name || ""}
          className={cn(errors.name && "border-red-500")}
          required
        />
        {errors.name && (
          <p className="text-xs text-red-500">{errors.name[0]}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Brief description of this category"
          defaultValue={category?.description || ""}
          rows={2}
        />
        {errors.description && (
          <p className="text-xs text-red-500">{errors.description[0]}</p>
        )}
      </div>

      {/* Parent Category */}
      <div className="space-y-2">
        <Label htmlFor="parent">Parent Category</Label>
        <Select name="parent" defaultValue={category?.parent?.toString() || ""}>
          <SelectTrigger className={cn(errors.parent && "border-red-500")}>
            <SelectValue placeholder="None (root category)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="None">None (root category)</SelectItem>
            {parentOptions
              .filter((cat) => cat._id !== category?._id)
              .map((cat) => (
                <SelectItem key={cat._id} value={cat._id}>
                  {"─".repeat(cat.level || 0)} {cat.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {errors.parent && (
          <p className="text-xs text-red-500">{errors.parent[0]}</p>
        )}
      </div>

      {/* Sort Order */}
      <div className="space-y-2">
        <Label htmlFor="sortOrder">Sort Order</Label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          min="0"
          defaultValue={category?.sortOrder || 0}
          className="w-24"
        />
        <p className="text-xs text-muted-foreground">
          Lower numbers appear first
        </p>
        {errors.sortOrder && (
          <p className="text-xs text-red-500">{errors.sortOrder[0]}</p>
        )}
      </div>

      {/* Active Status */}
      <div className="flex items-center gap-3">
        <Switch
          id="isActive"
          name="isActive"
          defaultChecked={category?.isActive ?? true}
          value="true"
        />
        <Label htmlFor="isActive">Active</Label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" asChild>
          <Link href="/dashboard/categories">Cancel</Link>
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isEditing ? "Updating..." : "Creating..."}
            </>
          ) : isEditing ? (
            "Update Category"
          ) : (
            "Create Category"
          )}
        </Button>
      </div>
    </form>
  );
}
