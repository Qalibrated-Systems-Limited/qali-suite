import { auth } from "@/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { canSeeInventoryNav } from "@/lib/permissions";
import { CreateAdjustmentForm } from "../components/CreateAdjustmentForm";
import Product from "@/app/models/product";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";

// Fetch products for adjustment (tenant-scoped)
async function getProducts() {
  await dbConnect();
  const { companyId } = await getTenantContext();

  const products = await Product.find({ companyId })
    .select("_id name SKU stock unit costing.costPrice")
    .sort({ name: 1 })
    .lean();

  return JSON.parse(JSON.stringify(products));
}

export default async function CreateAdjustmentPage() {
  const session = await auth();
  const { user } = session;

  // Single source of truth — same gate the sidebar uses for inventory.
  if (!canSeeInventoryNav(user?.role)) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Create Stock Adjustment</h1>
        <Alert className="bg-destructive/10 border-destructive/20">
          <Info className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive text-sm">
            You don't have permission to create stock adjustments. Contact your
            administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const products = await getProducts();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Create Stock Adjustment</h1>
        <p className="text-sm text-muted-foreground">
          Record inventory corrections, damaged goods, or stock discrepancies
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="bg-blue-500/10 border-blue-500/20">
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
