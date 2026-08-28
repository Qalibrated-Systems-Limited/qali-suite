import { auth } from "@/auth";
import Link from "next/link";
import { canSeeInventoryNav } from "@/lib/permissions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, ArrowLeft } from "lucide-react";
import { getCategoriesPg } from "@/app/db/actions/category-actions";
import { CreateStockCountForm } from "../components/CreateStockCountForm";

export const metadata = {
  title: "New Stock Count | Inventory",
};

export default async function CreateStockCountPage() {
  const session = await auth();
  const { user } = session;

  if (!canSeeInventoryNav(user?.role)) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">New Stock Count</h1>
        <Alert className="bg-destructive/10 border-destructive/20">
          <Info className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive text-xs sm:text-sm">
            You don&apos;t have permission to start a stock count. Contact your
            administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const categories = await getCategoriesPg();

  return (
    <div className="space-y-4 max-w-3xl">
      <Link
        href="/dashboard/stock-counts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Stock counts
      </Link>

      <div>
        <h1 className="text-lg font-semibold tracking-tight">New Stock Count</h1>
        <p className="text-sm text-muted-foreground">
          Opening a count does not freeze anything yet — you generate the sheet
          on the next screen, and that is the moment the book is frozen.
        </p>
      </div>

      <CreateStockCountForm categories={categories} />
    </div>
  );
}
