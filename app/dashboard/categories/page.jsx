// /app/dashboard/categories/page.jsx
// SERVER COMPONENT - No "use client"

import { auth } from "@/auth";
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  Sparkles,
  Search,
  FolderTree,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import {
  getCategoryTree,
  getCategories,
  seedDefaultCategories,
} from "../../mongodb/actions/category-actions";
import CategoryTree from "./components/CategoryTree";

export const metadata = {
  title: "Categories | ERP",
  description: "Manage product categories",
};

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

  // Fetch data on server
  const [treeResult, listResult] = await Promise.all([
    getCategoryTree(true),
    getCategories(true),
  ]);

  const tree = treeResult.tree || [];
  const flatList = listResult.categories || [];

  // Filter tree by search (server-side)
  const filterTree = (nodes, query) => {
    if (!query) return nodes;
    return nodes
      .map((node) => {
        const matches = node.name.toLowerCase().includes(query.toLowerCase());
        const filteredChildren = filterTree(node.children || [], query);
        if (matches || filteredChildren.length > 0) {
          return { ...node, children: filteredChildren };
        }
        return null;
      })
      .filter(Boolean);
  };

  const filteredTree = filterTree(tree, search || "");

  return (
    <div className="container py-6 space-y-6">
      {/* Success message from searchParams */}
      {success && (
        <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {decodeURIComponent(success.replace(/\+/g, " "))}
          </AlertDescription>
        </Alert>
      )}

      {/* Error message from searchParams */}
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

        <div className="flex items-center gap-2">
          {/* Seed Button - Form action */}
          {tree.length === 0 && (
            <form action={seedDefaultCategories}>
              <Button type="submit" variant="outline">
                <Sparkles className="mr-2 h-4 w-4" />
                Seed Defaults
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Search - Form that updates URL (no JS needed) */}
      <form action="/dashboard/categories" method="GET">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="search"
            placeholder="Search categories..."
            defaultValue={search || ""}
            className="pl-10"
          />
        </div>
      </form>

      {/* Category Tree */}
      <div className="border rounded-lg bg-card">
        {filteredTree.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search
              ? "No categories match your search"
              : "No categories yet. Create your first category or seed defaults."}
          </div>
        ) : (
          <div className="p-2">
            {/* CategoryTree is client component ONLY for expand/collapse */}
            <CategoryTree categories={filteredTree} />
          </div>
        )}
      </div>

      {/* Stats */}
      {tree.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{flatList.length} total categories</span>
          <span>•</span>
          <span>
            {flatList.filter((c) => c.level === 0).length} root categories
          </span>
        </div>
      )}
    </div>
  );
}
