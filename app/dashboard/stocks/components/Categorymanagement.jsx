"use client";

import { useState, useEffect, useActionState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  FolderTree,
  Loader2,
  AlertCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryTree,
  getCategories,
  seedDefaultCategories,
} from "../../../mongodb/actions/category-actions";

// ============================================
// CATEGORY TREE ITEM (Recursive)
// ============================================

function CategoryTreeItem({
  category,
  level = 0,
  onEdit,
  onDelete,
  expandedIds,
  toggleExpand,
}) {
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEdit(category)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Category</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{category.name}"?
                  {category.productCount > 0 && (
                    <span className="block mt-2 text-destructive font-medium">
                      Warning: This category has {category.productCount}{" "}
                      products. You must reassign them first.
                    </span>
                  )}
                  {hasChildren && (
                    <span className="block mt-2 text-destructive font-medium">
                      Warning: This category has subcategories. Delete them
                      first.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(category._id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
              onEdit={onEdit}
              onDelete={onDelete}
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
// CATEGORY FORM (Create/Edit)
// ============================================

function CategoryForm({ category, parentOptions, onClose }) {
  const isEditing = !!category;

  // Bind categoryId for update action
  const boundUpdateAction = category
    ? updateCategory.bind(null, category._id)
    : null;

  const [state, formAction, isPending] = useActionState(
    isEditing ? boundUpdateAction : createCategory,
    { error: null }
  );

  // Show errors via useEffect
  useEffect(() => {
    if (state?.error) {
      // Error state - form stays open, errors displayed inline
      // Could also show toast here if preferred
    }
    // Note: On success, redirect happens in action - no need to handle here
  }, [state]);

  // Get form-level error
  const formError = state?.error?._form?.[0];

  return (
    <form action={formAction} className="space-y-4">
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
          className={cn(state?.error?.name && "border-red-500")}
          required
        />
        {state?.error?.name && (
          <p className="text-xs text-red-500">{state.error.name[0]}</p>
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
      </div>

      {/* Parent Category */}
      <div className="space-y-2">
        <Label htmlFor="parent">Parent Category</Label>
        <Select name="parent" defaultValue={category?.parent?.toString() || ""}>
          <SelectTrigger
            className={cn(state?.error?.parent && "border-red-500")}
          >
            <SelectValue placeholder="None (root category)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None (root category)</SelectItem>
            {parentOptions
              .filter((cat) => cat._id !== category?._id)
              .map((cat) => (
                <SelectItem key={cat._id} value={cat._id}>
                  {"─".repeat(cat.level || 0)} {cat.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {state?.error?.parent && (
          <p className="text-xs text-red-500">{state.error.parent[0]}</p>
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

      {/* Submit Button */}
      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
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

// ============================================
// MAIN COMPONENT
// ============================================

export default function CategoryManagement() {
  const [tree, setTree] = useState([]);
  const [flatList, setFlatList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);

  // Load categories
  const refreshTree = async () => {
    setLoading(true);
    try {
      const [treeResult, listResult] = await Promise.all([
        getCategoryTree(true),
        getCategories(true),
      ]);

      if (treeResult.tree) {
        setTree(treeResult.tree);
        // Auto-expand root categories
        setExpandedIds(treeResult.tree.map((cat) => cat._id));
      }

      if (listResult.categories) {
        setFlatList(listResult.categories);
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to load categories" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshTree();
  }, []);

  // Auto-dismiss messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Toggle expand/collapse
  const toggleExpand = (id) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Handle edit
  const handleEdit = (category) => {
    setEditingCategory(category);
    setDialogOpen(true);
  };

  // Handle delete
  const handleDelete = async (categoryId) => {
    setLoading(true);
    try {
      const result = await deleteCategory(categoryId);
      // If we get here wxithout redirect, there was an error
      if (result?.error) {
        const errorMsg = result.error._form?.[0] || "Failed to delete category";
        setMessage({ type: "error", text: errorMsg });
      }
    } catch (error) {
      // Redirect throws NEXT_REDIRECT - this is expected on success
      // If it's a real error, show message
      if (error?.digest?.startsWith("NEXT_REDIRECT")) {
        // Success - refresh will happen via redirect
        return;
      }
      setMessage({ type: "error", text: "Failed to delete category" });
    } finally {
      setLoading(false);
      refreshTree();
    }
  };

  // Handle seed
  const handleSeed = async () => {
    setLoading(true);
    try {
      const result = await seedDefaultCategories();
      if (result?.error) {
        const errorMsg = result.error._form?.[0] || "Failed to seed categories";
        setMessage({ type: "error", text: errorMsg });
      }
    } catch (error) {
      if (error?.digest?.startsWith("NEXT_REDIRECT")) {
        return;
      }
      setMessage({ type: "error", text: "Failed to seed categories" });
    } finally {
      setLoading(false);
      refreshTree();
    }
  };

  // Handle dialog close
  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingCategory(null);
    refreshTree();
  };

  // Filter tree by search
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

  const filteredTree = filterTree(tree, searchQuery);

  return (
    <div className="space-y-6">
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
          {tree.length === 0 && !loading && (
            <Button variant="outline" onClick={handleSeed} disabled={loading}>
              <Sparkles className="mr-2 h-4 w-4" />
              Seed Defaults
            </Button>
          )}

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => setEditingCategory(null)}
                className="bg-yellow-500 hover:bg-yellow-600 text-black"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingCategory ? "Edit Category" : "Add Category"}
                </DialogTitle>
              </DialogHeader>
              <CategoryForm
                category={editingCategory}
                parentOptions={flatList}
                onClose={handleDialogClose}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search categories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Tree */}
      <div className="border rounded-lg bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchQuery
              ? "No categories match your search"
              : "No categories yet. Create your first category or seed defaults."}
          </div>
        ) : (
          <div className="p-2">
            {filteredTree.map((category) => (
              <CategoryTreeItem
                key={category._id}
                category={category}
                onEdit={handleEdit}
                onDelete={handleDelete}
                expandedIds={expandedIds}
                toggleExpand={toggleExpand}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      {!loading && tree.length > 0 && (
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
