// /app/dashboard/categories/[id]/edit/page.jsx
// SERVER COMPONENT

import { auth } from "@/auth";
import { AlertCircle, ArrowLeft, FolderTree } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategories,
  getCategory,
} from "../../../../mongodb/actions/category-actions";
import CategoryForm from "../../components/CategoryForm";

export const metadata = {
  title: "Edit Category | ERP",
  description: "Edit product category",
};

export default async function EditCategoryPage({ params }) {
  const { id } = await params;

  // Auth check
  const session = await auth();
  if (!session?.user) {
    return (
      <div className="container py-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>You must be logged in.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const ALLOWED = new Set([
    "SuperAdmin",
    "Admin",
    "CFO",
    "Finance Manager",
    "Manager",
    "Store Manager",
  ]);
  if (!ALLOWED.has(session.user.role)) {
    return (
      <div className="container py-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You don&apos;t have permission to manage categories.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Fetch category and parent options
  const [categoryResult, categoriesResult] = await Promise.all([
    getCategory(id),
    getCategories(true),
  ]);

  if (!categoryResult.category) {
    notFound();
  }

  const category = categoryResult.category;
  const categories = categoriesResult.categories || [];

  // Filter out current category and its descendants from parent options
  const filterDescendants = (cats, excludeId) => {
    return cats.filter((cat) => {
      if (cat._id === excludeId) return false;
      // Also filter if path includes excludeId
      if (cat.path && cat.path.includes(excludeId)) return false;
      return true;
    });
  };

  const parentOptions = filterDescendants(categories, id);

  return (
    <div className="container py-6 max-w-2xl">
      {/* Back Link */}
      <Button variant="ghost" asChild className="mb-6">
        <Link href="/dashboard/categories">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Categories
        </Link>
      </Button>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderTree className="h-6 w-6" />
          Edit Category
        </h1>
        <p className="text-sm text-muted-foreground">
          Update "{category.name}"
        </p>
      </div>

      {/* Form */}
      <div className="border rounded-lg bg-card p-6">
        <CategoryForm category={category} parentOptions={parentOptions} />
      </div>
    </div>
  );
}
