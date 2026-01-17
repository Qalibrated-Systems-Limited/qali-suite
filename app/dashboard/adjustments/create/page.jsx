import { auth } from "@/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { CreateAdjustmentForm } from "../components/CreateAdjustmentForm";
import Product from "@/app/models/product";
import dbConnect from "@/app/config/dbConnect";

// Fetch products for adjustment
async function getProducts() {
  await dbConnect();

  const products = await Product.find({})
    .select("_id name SKU stock unit costing.costPrice")
    .sort({ name: 1 })
    .lean();

  return JSON.parse(JSON.stringify(products));
}

export default async function CreateAdjustmentPage() {
  const session = await auth();
  const { user } = session;

  // Check if user has permission (Admin, Store Manager, Accountant)
  const hasPermission = ["Admin", "Store Manager", "Accountant"].includes(
    user?.role
  );

  if (!hasPermission) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Create Stock Adjustment
          </h1>
          <Alert className="bg-destructive/10 border-destructive/20">
            <Info className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive text-sm">
              You don't have permission to create stock adjustments. Contact your
              administrator.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const products = await getProducts();

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
          Create Stock Adjustment
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Record inventory corrections, damaged goods, or stock discrepancies
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="bg-blue-500/10 border-blue-500/20 mb-6">
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-blue-600 dark:text-blue-400 text-xs sm:text-sm">
          Stock adjustments create journal entries automatically. Increases
          debit Inventory, decreases credit Inventory.
        </AlertDescription>
      </Alert>

      {/* Form */}
      <CreateAdjustmentForm user={user} products={products} />
    </div>
  );
}
