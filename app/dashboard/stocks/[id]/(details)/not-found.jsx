// app/(dashboard)/products/[id]/not-found.jsx
// 404 page for Product not found

import Link from "next/link";
import { Package, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <div className="flex-1 flex items-center justify-center py-20">
      <div className="max-w-md w-full text-center px-4">
        {/* Icon */}
        <div className="inline-flex items-center justify-center size-16 rounded-full bg-muted mb-6">
          <Package className="size-8 text-muted-foreground" />
        </div>

        {/* Message */}
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground mb-2">
          Product not found
        </h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
          The product you&apos;re looking for doesn&apos;t exist or may have
          been removed. Check the SKU or browse all products.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild>
            <Link href="/products">
              <ArrowLeft className="size-4 mr-2" />
              Back to Products
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/products/new">
              <Plus className="size-4 mr-2" />
              Add Product
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
