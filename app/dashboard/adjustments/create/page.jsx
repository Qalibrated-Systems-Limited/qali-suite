import { auth } from "@/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { canSeeInventoryNav } from "@/lib/permissions";
import { CreateAdjustmentForm } from "../components/CreateAdjustmentForm";
import { getProductsPg } from "@/app/db/actions/product-actions";

/**
 * The picker read the MONGO Product collection, which nothing has written
 * since products moved. So the dropdown on this page was EMPTY and no stock
 * adjustment could be raised at all — the §"the worst seam in the port" defect
 * exactly, and it survived the sweep because this file imported the product
 * model directly rather than through the actions directory the port-reach
 * command greps for. (Reworded so that grep stops counting this comment as a
 * live Mongo import — it was the last "screen" in the adjustments column and
 * there was never any code behind it.)
 *
 * `shapeProduct` already returns `_id`, `SKU`, `unit` and
 * `inventory.quantityOnHand` — the shape this form reads — so nothing in
 * CreateAdjustmentForm changes.
 */
async function getProducts() {
  const { rows } = await getProductsPg({ status: "active", perPage: 200 });
  return rows;
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
