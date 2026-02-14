// /app/dashboard/categories/page.jsx
// SERVER COMPONENT

import { Suspense } from "react";
import { auth } from "@/auth";
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  Sparkles,
  FolderTree,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { seedDefaultCategories, getCategories } from "../../mongodb/actions/category-actions";
import {
  CategoryStatsCards,
  CategoryStatsSkeleton,
  CategoryTreeServer,
  CategoryTreeSkeleton,
} from "./components/CategoryServerComponents";
import CategorySearch from "./components/CategorySearch";

export const metadata = {
  title: "Categories | ERP",
  description: "Manage product categories",
};

// ============================================
// ACTION BUTTONS (Async - checks if categories exist)
// ============================================

async function ActionButtons() {
  const { categories = [] } = await getCategories(true);
  const hasCategories = categories.length > 0;

  return (
    <div className="flex items-center gap-2">
      {/* Seed Button - Only show if no categories */}
      {!hasCategories && (
        <form action={seedDefaultCategories}>
          <Button type="submit" variant="outline">
            <Sparkles className="mr-2 h-4 w-4" />
            Seed Defaults
          </Button>
        </form>
      )}

      {/* Create Category Button */}
      <Button asChild>
        <Link href="/dashboard/categories/create">
          <Plus className="mr-2 h-4 w-4" />
          New Category
        </Link>
      </Button>
    </div>
  );
}

function ActionButtonsSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-10 w-36" />
    </div>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default async function CategoriesPage({ searchParams }) {
  const { success, error, search } = await searchParams;

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

  const userRole = session.user.role?.toLowerCase();
  if (!["admin", "manager"].includes(userRole)) {
    return (
      <div className="container py-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Admin or Manager role required.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      {/* Success message */}
      {success && (
        <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {decodeURIComponent(success.replace(/\+/g, " "))}
          </AlertDescription>
        </Alert>
      )}

      {/* Error message */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {decodeURIComponent(error.replace(/\+/g, " "))}
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderTree className="h-6 w-6" />
            Categories
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage product categories and hierarchy
          </p>
        </div>

        <Suspense fallback={<ActionButtonsSkeleton />}>
          <ActionButtons />
        </Suspense>
      </div>

      {/* Stats Cards - Stream in independently */}
      <Suspense fallback={<CategoryStatsSkeleton />}>
        <CategoryStatsCards />
      </Suspense>

      {/* Search - Client component with useTransition (no page refresh) */}
      <CategorySearch defaultValue={search || ""} />

      {/* Category Tree - Stream in independently */}
      <Card className="border rounded-lg bg-card">
        <Suspense fallback={<CategoryTreeSkeleton />}>
          <CategoryTreeServer search={search} />
        </Suspense>
      </Card>
    </div>
  );
}
