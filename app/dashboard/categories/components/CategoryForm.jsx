"use client";

// /components/categories/CategoryForm.jsx
// Client component for form state management with useActionState

import { useActionState, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CategoryCombobox } from "@/app/dashboard/stocks/components/CategoryCombobox";
import { cn } from "@/lib/utils";
import Link from "next/link";

import {
  createCategoryPg as createCategory,
  updateCategoryPg as updateCategory,
} from "@/app/db/actions/category-actions";

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

  // The actions return `error` as a single string. This used to read it as a
  // field map (`errors._form[0]`, `errors.name[0]`), which a string never
  // matches — so every failure left the button spinning back to idle with
  // nothing on screen.
  const formError = state?.success === false ? state.error : null;
  const errors = {};

  // Empty means a root category; the action reads "" as no parent.
  const [parent, setParent] = useState(category?.parent?.toString() || "");

  // Labelled by full path — "Electronics > Scales" — so a search matches any
  // ancestor, and two "Accessories" under different parents are told apart.
  const parentChoices = parentOptions
    .filter((cat) => cat._id !== category?._id)
    .map((cat) => ({ ...cat, name: cat.path || cat.name, level: 0 }));

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
        <CategoryCombobox
          name="parent"
          value={parent}
          onChange={setParent}
          categories={parentChoices}
          placeholder="None (root category)"
        />
        {parent && (
          <button
            type="button"
            onClick={() => setParent("")}
            className="text-xs text-muted-foreground hover:underline"
          >
            Make it a root category
          </button>
        )}
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
