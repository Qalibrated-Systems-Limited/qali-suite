// /app/dashboard/categories/page.jsx
// SERVER COMPONENT

import { Suspense } from "react";
import { auth } from "@/auth";
import { canSeeInventoryNav } from "@/lib/permissions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertCircle, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import { FormBanner } from "@/components/ui/form-banner";
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
// MAIN PAGE COMPONENT
// ============================================

export default async function CategoriesPage({ searchParams }) {
  const { search } = await searchParams;

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

  // Single source of truth — sidebar shows this to anyone in
  // canSeeInventoryNav. Accountant, Sales Manager, Procurement Officer
  // and Storekeeper could see the link but the previous inline allowlist
  // bounced them.
  if (!canSeeInventoryNav(session.user.role)) {
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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <SiteHeader
        title="Categories"
        description="Manage product categories and hierarchy"
        Action={() => (
          <Button asChild size="sm">
            <Link href="/dashboard/categories/create">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Category
            </Link>
          </Button>
        )}
      />

      {/* Success/Error Banner */}
      <FormBanner searchParams={await searchParams} />

      {/* Stats Cards - Stream in independently */}
      <Suspense fallback={<CategoryStatsSkeleton />}>
        <CategoryStatsCards />
      </Suspense>

      {/* Search */}
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
