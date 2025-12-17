import {
  searchStock,
  fetchStockPages,
  fetchStockData,
} from "../../../mongodb/queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { ResponsiveInventoryTable } from "../table";
import { auth } from "../../../../auth";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "../../../../components/ui/card";
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
  const cart = userCart?.cart ?? [];
  const canCreateStock = user.role === "Store Manager" || user.role === "Admin";

  // Build filters object
  const filters = {
    category: category !== "all" ? category : "",
    quantity: quantityFilter !== "all" ? quantityFilter : "",
  };

  const totalPages = await fetchStockPages(query, filters);
  const stock = await searchStock(query, currentPage, filters);
  const stockData = await fetchStockData();

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
        Action={canCreateStock && Action}
      />

      {/* Search and Filters */}
      <Card className="bg-[#161b22] border-[#30363d]">
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
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[#30363d]">
                <span className="text-xs text-gray-400">Active filters:</span>
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

      {/* Stock Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-400">Total Items</p>
            <p className="text-2xl font-bold text-white">{stock.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-400">Low Stock</p>
            <p className="text-2xl font-bold text-orange-500">
              {stock.filter((item) => item.stock > 0 && item.stock < 10).length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-400">Out of Stock</p>
            <p className="text-2xl font-bold text-red-500">
              {stock.filter((item) => item.stock === 0).length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-400">In Stock</p>
            <p className="text-2xl font-bold text-green-500">
              {stock.filter((item) => item.stock >= 10).length}
            </p>
          </CardContent>
        </Card>
      </div>

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
