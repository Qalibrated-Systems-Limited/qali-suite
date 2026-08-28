import UpdateStockForm from "./form";
import { notFound } from "next/navigation";
import { auth } from "../../../../../auth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { getCategoriesPg as getCategories } from "@/app/db/actions/category-actions";
import { getProductPg } from "@/app/db/actions/product-actions";

async function UpdateStockPage(props) {
  const params = await props.params;
  const id = params.id;

  const session = await auth();
  const user = session && session.user;
  const canUpdateStock =
    user?.role === "Store Manager" || user?.role === "Admin";
  // Both reads were Mongo, and both were broken. `Category.find({})` had no
  // tenant filter and read a collection nothing has written since 0062, so the
  // dropdown was empty. `Product.findOne({ _id: id })` was worse than empty:
  // `id` is a uuid now, so Mongoose threw a CastError and this page 500'd
  // rather than rendering at all.
  const categories = await getCategories();

  if (!canUpdateStock) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <Card className="max-w-md w-full bg-card border-border">
          <CardContent className="pt-6">
            <Alert
              variant="destructive"
              className="bg-red-500/10 border-red-500/20"
            >
              <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
              <AlertTitle className="text-red-600 dark:text-red-400 font-semibold">
                Access Denied
              </AlertTitle>
              <AlertDescription className="text-red-600 dark:text-red-400 mt-2">
                You don't have permission to update stock items. Only Store
                Managers and Administrators can edit stock.
              </AlertDescription>
            </Alert>
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                className="border-border text-foreground hover:bg-accent"
                asChild
              >
                <Link href="/dashboard/stocks">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Stock
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stock = await getProductPg(id);

  if (!stock) {
    return notFound();
  }

  // `shapeProduct` already returns `categoryId` from the real foreign key, so
  // the name match is only a fallback — 0062 kept `category` as a text
  // SNAPSHOT of what the product was filed under, and a product created before
  // the tree existed has the text and no id.
  if (!stock.categoryId) {
    stock.categoryId =
      categories.find((cat) => cat.name === stock.category)?._id || "";
  }

  return (
    <main className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard/stocks"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Stocks
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground hover:text-foreground transition-colors">
          {stock.name}
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground font-medium">Edit</span>
      </div>

      {/* Form */}
      <UpdateStockForm
        product={stock}
        categories={categories}
        userRole={user?.role || "employee"}
      />
    </main>
  );
}

export default UpdateStockPage;
