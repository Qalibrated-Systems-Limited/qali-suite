import { auth } from "../../../../auth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import AddProductWizard from "../components/AddProductWizard";
import { getCategories } from "@/app/mongodb/actions/category-actions";
import Category from "@/app/models/category";

async function CreateStockPage() {
  const session = await auth();
  const user = session && session.user;
  const canCreateStock =
    user?.role === "Store Manager" || user?.role === "Admin";
  const result = (await Category.find({}).lean()) ?? [];

  const categories = result.map((cat) => {
    const id = cat._id.toString();
    return { _id: id, name: cat.name };
  });

  // Fetch categories if needed

  if (!canCreateStock) {
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
                You don't have permission to create stock items. Only Store
                Managers and Administrators can add new stock.
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
        <span className="text-foreground font-medium">Add Stock</span>
      </div>

      {/* Form */}
      <AddProductWizard userRole={user?.role} categories={categories} />
    </main>
  );
}

export default CreateStockPage;
