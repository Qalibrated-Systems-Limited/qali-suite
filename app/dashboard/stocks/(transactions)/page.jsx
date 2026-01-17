import {
  searchStock,
  fetchStockPages,
  fetchStockData,
} from "../../../mongodb/queries/queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { ResponsiveInventoryTable } from "../table";
import { auth } from "../../../../auth";
import { Card, CardContent } from "../../../../components/ui/card";
import User from "../../../models/user";
import { SiteHeader } from "@/components/site-header";
import { AddButton } from "@/components/buttons";
import { GenerateStockPDF } from "../export-to-pdf";
import {
  StockCategoryFilter,
  StockQuantityFilter,
  ClearStockFiltersButton,
  StockFilterBadge,
} from "@/components/custom-filters";
import { Package, AlertTriangle, XCircle, CheckCircle } from "lucide-react";
import { FormBanner } from "@/components/ui/form-banner";

async function StockPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  const query = searchParams.query || "";
  const category = searchParams.category || "all";
  const quantityFilter = searchParams.quantity || "all";
  const action = searchParams.action || "";

  const currentPage = Number(searchParams.page) || 1;

  const { user } = session;
  const userId = user.id;
  const userCart = await User.findById(userId).select("cart");

  // Serialize cart data for client component
  const cart = userCart?.cart?.map((item) => ({
    ...item.toObject(),
    _id: item._id?.toString(),
    productId: item.productId?.toString(),
  })) ?? [];

  const canCreateStock = user.role === "Store Manager" || user.role === "Admin";

  // Build filters object
  const filters = {
    category: category !== "all" ? category : "",
    quantity: quantityFilter !== "all" ? quantityFilter : "",
  };

  const totalPages = await fetchStockPages(query, filters);
  const stock = await searchStock(query, currentPage, filters);
  const stockData = await fetchStockData();

  // Calculate stats
  const totalItems = stock.length;
  const lowStock = stock.filter(
    (item) => item.stock > 0 && item.stock < 10
  ).length;
  const outOfStock = stock.filter((item) => item.stock === 0).length;
  const inStock = stock.filter((item) => item.stock >= 10).length;

  // Check if any filters are active
  const hasActiveFilters = category !== "all" || quantityFilter !== "all";

  const Action = () => (
    <div className="flex gap-2 items-center">
      <GenerateStockPDF stockData={stockData} />
      {canCreateStock && <AddButton url="/dashboard/stocks/create" />}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <SiteHeader
        title={
          action === "request"
            ? "Add Items you are requesting to cart"
            : "Stock Inventory"
        }
        description={
          action === "request"
            ? "Select items to add to your request"
            : "Manage your inventory and stock levels"
        }
        Action={canCreateStock && Action}
      />

      {/* Success/Error Banner */}
      <FormBanner searchParams={searchParams} />

      {/* Stock Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Items</p>
                <p className="text-2xl font-bold text-foreground">
                  {totalItems}
                </p>
              </div>
              <Package className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Low Stock</p>
                <p className="text-2xl font-bold text-orange-500">{lowStock}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Below 10 units</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Out of Stock</p>
                <p className="text-2xl font-bold text-red-500">{outOfStock}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Requires restock</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">In Stock</p>
                <p className="text-2xl font-bold text-green-500">{inStock}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                10+ units available
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by product name or SKU..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <StockCategoryFilter currentCategory={category} />
              <StockQuantityFilter currentQuantity={quantityFilter} />

              {/* Clear Filters Button */}
              {hasActiveFilters && <ClearStockFiltersButton />}
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {category !== "all" && (
                  <StockFilterBadge
                    label="Category"
                    value={category}
                    param="category"
                  />
                )}
                {quantityFilter !== "all" && (
                  <StockFilterBadge
                    label="Stock Level"
                    value={quantityFilter}
                    param="quantity"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stock Table */}
      <ResponsiveInventoryTable stock={stock} cart={cart} action={action} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default StockPage;
