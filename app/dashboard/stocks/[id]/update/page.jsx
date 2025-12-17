import UpdateStockForm from "./form";
import { notFound } from "next/navigation";
import Product from "../../../../models/product";
import { auth } from "../../../../../auth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

async function UpdateStockPage(props) {
  const params = await props.params;
  const id = params.id;

  const session = await auth();
  const user = session && session.user;
  const canUpdateStock =
    user?.role === "Store Manager" || user?.role === "Admin";

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

  if (stock) {
    stock = {
      name: stock.name,
      SKU: stock.SKU,
      description: stock.description,
      category: stock.category,
      price: stock.price,
      stock: stock.stock,
      unit: stock.unit,
      _id: stock._id.toString(),
    };
  }

  if (!stock) {
    return notFound();
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
      <UpdateStockForm stock={stock} />
    </main>
  );
}

export default UpdateStockPage;
