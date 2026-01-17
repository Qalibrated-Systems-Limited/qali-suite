import UpdateStockForm from "./form";
import { notFound } from "next/navigation";
import Product from "../../../../models/product";
import { auth } from "../../../../../auth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Category from "@/app/models/category";
import { serializeBsonType } from "@/lib/utils";

async function UpdateStockPage(props) {
  const params = await props.params;
  const id = params.id;

  const session = await auth();
  const user = session && session.user;
  const canUpdateStock =
    user?.role === "Store Manager" || user?.role === "Admin";
  const result = (await Category.find({}).lean()) ?? [];

  const categories = result.map((cat) => {
    const id = cat._id.toString();
    return { _id: id, name: cat.name };
  });

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

  let stock = await Product.findOne({ _id: id });

  if (!stock) {
    return notFound();
  }

  // Find the category ID from the category name stored in product
  const productCategoryName = stock.category;
  const matchingCategory = categories.find(cat => cat.name === productCategoryName);

  // Serialize and add the category ID for the form
  stock = serializeBsonType(stock);
  stock.categoryId = matchingCategory?._id || "";

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
