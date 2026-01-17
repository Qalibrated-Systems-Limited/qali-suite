"use client";

// /components/categories/CategoryTree.jsx
// Client component ONLY for expand/collapse interactivity
// All data passed from server, mutations use form actions

import { useState } from "react";
import { ChevronRight, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { cn } from "@/lib/utils";
import DeleteCategoryForm from "./DeleteCategoryForm";

// ============================================
// TREE ITEM (Recursive)
// ============================================

function CategoryTreeItem({ category, level = 0, expandedIds, toggleExpand }) {
  const hasChildren = category.children && category.children.length > 0;
  const isExpanded = expandedIds.includes(category._id);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors",
          level > 0 && "ml-6"
        )}
      >
        {/* Expand/Collapse Button */}
        <button
          type="button"
          onClick={() => toggleExpand(category._id)}
          className={cn(
            "p-1 rounded hover:bg-muted",
            !hasChildren && "invisible"
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* Category Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{category.name}</span>
            {!category.isActive && (
              <Badge variant="secondary" className="text-xs">
                Inactive
              </Badge>
            )}
            {category.productCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {category.productCount} products
              </Badge>
            )}
          </div>
          {category.description && (
            <p className="text-xs text-muted-foreground truncate">
              {category.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Edit - Simple Link (no JS needed) */}
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href={`/dashboard/categories/${category._id}/edit`}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>

          {/* Delete - Form action with confirmation */}
          <DeleteCategoryForm
            categoryId={category._id}
            categoryName={category.name}
            productCount={category.productCount || 0}
            hasChildren={hasChildren}
          />
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="border-l border-border ml-6">
          {category.children.map((child) => (
            <CategoryTreeItem
              key={child._id}
              category={child}
              level={level + 1}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN TREE COMPONENT
// ============================================

export default function CategoryTree({ categories }) {
  // Only client state needed: which items are expanded
  const [expandedIds, setExpandedIds] = useState(
    // Default: expand all root categories
    categories.map((cat) => cat._id)
  );

  const toggleExpand = (id) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  return (
    <>
      {categories.map((category) => (
        <CategoryTreeItem
          key={category._id}
          category={category}
          expandedIds={expandedIds}
          toggleExpand={toggleExpand}
        />
      ))}
    </>
  );
}
