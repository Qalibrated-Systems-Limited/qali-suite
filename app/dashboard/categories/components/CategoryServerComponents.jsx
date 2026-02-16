import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderTree, FolderCheck, FolderX, Package, Layers } from "lucide-react";
import {
  getCategoryStats,
  getCategoryTree,
  searchCategories,
} from "@/app/mongodb/queries/category-queries";
import CategoryTree from "./CategoryTree";

// ============================================
// CATEGORY STATS CARDS (Async Server Component)
// ============================================

export async function CategoryStatsCards() {
  const stats = await getCategoryStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">
                {stats.total}
              </p>
            </div>
            <FolderTree className="w-8 h-8 text-blue-500" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-green-500">
                {stats.active}
              </p>
            </div>
            <FolderCheck className="w-8 h-8 text-green-500" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Inactive</p>
              <p className="text-2xl font-bold text-orange-500">
                {stats.inactive}
              </p>
            </div>
            <FolderX className="w-8 h-8 text-orange-500" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">With Products</p>
              <p className="text-2xl font-bold text-purple-500">
                {stats.withProducts}
              </p>
            </div>
            <Package className="w-8 h-8 text-purple-500" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Root Categories</p>
              <p className="text-2xl font-bold text-cyan-500">
                {stats.rootCategories}
              </p>
            </div>
            <Layers className="w-8 h-8 text-cyan-500" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// CATEGORY STATS SKELETON
// ============================================

export function CategoryStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {[...Array(5)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="h-8 w-8 rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// CATEGORY TREE SERVER (Async Server Component)
// ============================================

export async function CategoryTreeServer({ search }) {
  const tree = await getCategoryTree(false);

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

  if (filteredTree.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {search
          ? "No categories match your search"
          : "No categories yet. Create your first category to get started."}
      </div>
    );
  }

  return (
    <div className="p-2">
      <CategoryTree categories={filteredTree} />
    </div>
  );
}

// ============================================
// CATEGORY TREE SKELETON
// ============================================

export function CategoryTreeSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {[...Array(6)].map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ============================================
// SEARCH RESULTS SERVER (For search mode)
// ============================================

export async function CategorySearchResultsServer({ search }) {
  if (!search || search.trim().length < 2) {
    return null;
  }

  const results = await searchCategories(search);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No categories found matching "{search}"
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {results.map((cat) => (
        <div
          key={cat._id}
          className="flex items-center justify-between p-3 hover:bg-muted/50"
        >
          <div>
            <p className="font-medium">{cat.name}</p>
            {cat.path && cat.path !== cat.name && (
              <p className="text-xs text-muted-foreground">{cat.path}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!cat.isActive && (
              <span className="text-xs bg-orange-500/10 text-orange-500 px-2 py-1 rounded">
                Inactive
              </span>
            )}
            {cat.productCount > 0 && (
              <span className="text-xs bg-muted px-2 py-1 rounded">
                {cat.productCount} products
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
