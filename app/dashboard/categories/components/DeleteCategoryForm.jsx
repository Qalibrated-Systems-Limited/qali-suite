"use client";

// /components/categories/DeleteCategoryForm.jsx
// Client component for delete confirmation dialog
// Uses form action for actual deletion

import { useActionState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { deleteCategory } from "../../../mongodb/actions/category-actions";

export default function DeleteCategoryForm({
  categoryId,
  categoryName,
  productCount = 0,
  hasChildren = false,
}) {
  // Bind the categoryId to the delete action
  const boundDeleteAction = deleteCategory.bind(null, categoryId);

  const [state, formAction, isPending] = useActionState(
    boundDeleteAction,
    null
  );

  // Check if deletion is blocked
  const isBlocked = productCount > 0 || hasChildren;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Category</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>Are you sure you want to delete "{categoryName}"?</p>

              {productCount > 0 && (
                <p className="mt-2 text-destructive font-medium">
                  ⚠️ This category has {productCount} products. You must
                  reassign them first.
                </p>
              )}

              {hasChildren && (
                <p className="mt-2 text-destructive font-medium">
                  ⚠️ This category has subcategories. Delete them first.
                </p>
              )}

              {state?.error?._form && (
                <p className="mt-2 text-destructive font-medium">
                  Error: {state.error._form[0]}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>

          {isBlocked ? (
            <Button disabled variant="destructive">
              Cannot Delete
            </Button>
          ) : (
            <form action={formAction}>
              <AlertDialogAction
                type="submit"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </form>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
