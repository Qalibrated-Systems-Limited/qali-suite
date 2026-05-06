// app/(dashboard)/products/[id]/page.jsx
// Server Component - Product Detail Page
// Uses existing Qalibrated design system

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  DollarSign,
  BarChart3,
  FileText,
  History,
  Link2,
  ChevronRight,
  Copy,
  Calculator,
  Warehouse,
  Building2,
  Tag,
  Hash,
  Scale,
  Activity,
  Box,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
  Edit,
  MoreHorizontal,
  Plus,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/auth";
import { canSeePricing, canEditPricing } from "@/lib/permissions";
import { getProduct } from "@/app/mongodb/actions/stock-actions";
import PricingDialog from "../components/PricingDialog";
import { getRecentMovements } from "@/app/mongodb/queries/erp-dashboard-queries";
import {
  getActiveCheckouts,
  getAProductActiveCheckouts,
  getAProductPendingRequests,
  getAProductRecentMovements,
  getPendingRequests,
} from "@/app/mongodb/queries/stock-queries";
import { formatCurrency } from "@/lib/utils/erp-utils";
import { FormBanner } from "@/components/ui/form-banner";

// ============================================
// DATA FETCHING
// ============================================

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatDate(date, style = "medium") {
  if (!date) return "—";
  const d = new Date(date);
  if (style === "relative") {
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatNumber(num) {
  if (num === null || num === undefined) return "0";
  return new Intl.NumberFormat("en-KE").format(num);
}

function getStockStatus(product) {
  const qty = product.inventory?.quantityOnHand ?? 0;
  const reorderLevel = product.inventory?.reorderLevel ?? 0;

  if (qty <= 0) {
    return {
      level: "out",
      label: "Out of Stock",
      textColor: "text-red-500",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
      iconBg: "bg-red-500/20",
      Icon: AlertCircle,
    };
  }
  if (reorderLevel > 0 && qty <= reorderLevel) {
    return {
      level: "low",
      label: "Low Stock",
      textColor: "text-amber-500",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      iconBg: "bg-amber-500/20",
      Icon: AlertTriangle,
    };
  }
  return {
    level: "ok",
    label: "In Stock",
    textColor: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    iconBg: "bg-emerald-500/20",
    Icon: CheckCircle2,
  };
}

// ============================================
// SUB-COMPONENTS
// ============================================

// Status Badge
function StatusBadge({ status }) {
  const config = {
    active: {
      bg: "bg-emerald-500/20",
      text: "text-emerald-500",
      dot: "bg-emerald-500",
    },
    inactive: {
      bg: "bg-muted",
      text: "text-muted-foreground",
      dot: "bg-muted-foreground",
    },
    discontinued: {
      bg: "bg-red-500/20",
      text: "text-red-500",
      dot: "bg-red-500",
    },
  };
  const style = config[status] || config.inactive;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${style.bg} ${style.text}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {status?.charAt(0).toUpperCase() + status?.slice(1)}
    </span>
  );
}

// KPI Card - matches your dashboard style
function KPICard({
  icon: Icon,
  label,
  value,
  iconColor = "text-primary",
  iconBg = "bg-primary/20",
  trend,
  trendLabel,
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div
          className={`inline-flex items-center justify-center size-10 sm:size-11 rounded-lg ${iconBg}`}
        >
          <Icon className={`size-5 ${iconColor}`} />
        </div>
        {trend !== undefined && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${
              trend >= 0 ? "text-emerald-500" : "text-red-500"
            }`}
          >
            {trend >= 0 ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-3">{label}</p>
      <p className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight mt-0.5">
        {value}
      </p>
      {trendLabel && (
        <p className="text-xs text-muted-foreground mt-1">{trendLabel}</p>
      )}
    </div>
  );
}

// Stock Alert Banner
function StockAlert({ product }) {
  const status = getStockStatus(product);
  if (status.level === "ok") return null;

  const qty = product.inventory?.quantityOnHand ?? 0;
  const reorderLevel = product.inventory?.reorderLevel ?? 0;
  const Icon = status.Icon;

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-xl border ${status.borderColor} ${status.bgColor}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`size-10 rounded-lg ${status.iconBg} flex items-center justify-center shrink-0`}
        >
          <Icon className={`size-5 ${status.textColor}`} />
        </div>
        <div>
          <p className={`text-sm font-medium ${status.textColor}`}>
            {status.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {status.level === "out"
              ? "No units available for fulfillment"
              : `${qty} remaining • Reorder level is ${reorderLevel}`}
          </p>
        </div>
      </div>
      <div className="sm:ml-auto">
        <Button size="sm" asChild>
          <Link href="/purchase-orders/new">
            <Plus className="size-4 mr-1.5" />
            Create Purchase Order
          </Link>
        </Button>
      </div>
    </div>
  );
}

// Section Card
function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Icon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="px-4 sm:px-5 py-4">{children}</div>
    </div>
  );
}

// Data Row
function DataRow({ label, value, mono = false, valueColor }) {
  // Safely handle value - ensure it's a primitive that can be rendered
  const displayValue =
    value == null || value === ""
      ? "—"
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm text-right ${valueColor || "text-foreground"} ${
          mono ? "font-mono" : ""
        }`}
      >
        {displayValue}
      </span>
    </div>
  );
}

// Movement Row
function MovementRow({ movement }) {
  const typeConfig = {
    purchase: {
      icon: ArrowDownRight,
      color: "text-emerald-500",
      bg: "bg-emerald-500/20",
      label: "Purchase",
    },
    sale: {
      icon: ArrowUpRight,
      color: "text-blue-500",
      bg: "bg-blue-500/20",
      label: "Sale",
    },
    issue: {
      icon: Package,
      color: "text-amber-500",
      bg: "bg-amber-500/20",
      label: "Issue",
    },
    return: {
      icon: RotateCcw,
      color: "text-purple-500",
      bg: "bg-purple-500/20",
      label: "Return",
    },
    adjustment: {
      icon: Scale,
      color: "text-muted-foreground",
      bg: "bg-muted",
      label: "Adjustment",
    },
    initial: {
      icon: Box,
      color: "text-primary",
      bg: "bg-primary/20",
      label: "Initial",
    },
  };

  const config = typeConfig[movement.type] || typeConfig.adjustment;
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div
        className={`size-8 rounded-lg ${config.bg} flex items-center justify-center shrink-0`}
      >
        <Icon className={`size-4 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {movement.reference || movement.movementNumber}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(movement.createdAt, "relative")} • {config.label}
        </p>
      </div>
      <span
        className={`text-sm font-mono font-medium ${
          movement.direction === "in"
            ? "text-emerald-500"
            : "text-muted-foreground"
        }`}
      >
        {movement.direction === "in" ? "+" : "-"}
        {movement.quantity}
      </span>
    </div>
  );
}

// Request Row
function RequestRow({ request }) {
  const statusConfig = {
    pending: { color: "text-amber-500", bg: "bg-amber-500/20" },
    approved: { color: "text-emerald-500", bg: "bg-emerald-500/20" },
    partial: { color: "text-blue-500", bg: "bg-blue-500/20" },
    fulfilled: { color: "text-emerald-500", bg: "bg-emerald-500/20" },
  };

  const config = statusConfig[request.status] || statusConfig.pending;
  const totalQty =
    request.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {request.requestNumber}
          </span>
          <span
            className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${config.bg} ${config.color}`}
          >
            {request.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {request.requestedBy?.name || "Unknown"} •{" "}
          {request.requestType?.replace(/_/g, " ")}
        </p>
      </div>
      <span className="text-sm font-mono text-muted-foreground">
        ×{totalQty}
      </span>
    </div>
  );
}

// Checkout Row
function CheckoutRow({ checkout }) {
  const isOverdue =
    checkout.status === "overdue" ||
    (checkout.expectedReturnDate &&
      new Date(checkout.expectedReturnDate) < new Date());

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {checkout.checkoutNumber}
        </p>
        <p className="text-xs text-muted-foreground">
          {checkout.employee?.name || "Unknown"}
        </p>
      </div>
      <div className="text-right">
        <span className="text-sm font-mono text-muted-foreground">
          ×{checkout.quantity}
        </span>
        <p
          className={`text-xs ${
            isOverdue ? "text-red-500" : "text-muted-foreground"
          }`}
        >
          {isOverdue
            ? "Overdue"
            : `Due ${formatDate(checkout.expectedReturnDate, "relative")}`}
        </p>
      </div>
    </div>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================
export default async function ProductDetailPage({ params, searchParams }) {
  const { id } = await params;

  const product = await getProduct(id);
  if (!product) notFound();

  const session = await auth();
  const role = session?.user?.role;
  const showPricing = canSeePricing(role);
  const canEditPrice = canEditPricing(role);

  const [movements, requests, checkouts] = await Promise.all([
    getAProductRecentMovements(id),
    getAProductPendingRequests(id),
    getAProductActiveCheckouts(id),
  ]);

  const qty = product.inventory?.quantityOnHand ?? 0;
  const committed = product.inventory?.quantityCommitted ?? 0;
  const available = product.inventory?.quantityAvailable ?? qty;
  const costPrice = product.costing?.costPrice ?? 0;
  const sellPrice = product.pricing?.sellingPrice ?? 0;
  const inventoryValue = qty * costPrice;
  const margin = product.pricing?.marginPercentage ?? 0;

  return (
    <div className="flex-1 space-y-6">
      {/* Success/Error Banner */}
      <FormBanner searchParams={searchParams} />

      {/* Page Header */}
      <div className="space-y-1">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            href="/dashboard/stocks"
            className="hover:text-foreground transition-colors"
          >
            Products
          </Link>
          <ChevronRight className="size-4" />
          <span className="text-foreground font-medium truncate max-w-75">
            {product.name}
          </span>
        </div>

        {/* Title & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
                {product.name}
              </h1>
              <StatusBadge status={product.status} />
            </div>
            <p className="text-muted-foreground">
              View and manage product details
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/adjustments/create?productId=${id}`}>
                <Scale className="size-4 mr-1.5" />
                <span className="hidden sm:inline">Adjust Stock</span>
                <span className="sm:hidden">Adjust</span>
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/dashboard/stocks/${id}/update`}>
                <Edit className="size-4 mr-1.5" />
                <span className="hidden sm:inline">Edit Product</span>
                <span className="sm:hidden">Edit</span>
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-9">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/requests/create?product=${id}`}>
                    <Layers className="size-4 mr-2" />
                    Create Request
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/movements?productId=${id}`}>
                    <History className="size-4 mr-2" />
                    View Movements
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/products/${id}/duplicate`}>
                    <Copy className="size-4 mr-2" />
                    Duplicate
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Stock Alert */}
      <StockAlert product={product} />

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          icon={Box}
          label="On Hand"
          value={formatNumber(qty)}
          iconColor="text-primary"
          iconBg="bg-primary/20"
          trendLabel={committed > 0 ? `${available} available` : undefined}
        />
        <KPICard
          icon={Clock}
          label="Committed"
          value={formatNumber(committed)}
          iconColor="text-amber-500"
          iconBg="bg-amber-500/20"
        />
        <KPICard
          icon={CheckCircle2}
          label="Available"
          value={formatNumber(available)}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/20"
        />
        {showPricing && (
          <KPICard
            icon={BarChart3}
            label="Margin"
            value={`${margin.toFixed(1)}%`}
            iconColor="text-blue-500"
            iconBg="bg-blue-500/20"
            trend={margin > 25 ? margin - 25 : margin - 25}
          />
        )}
      </div>

      {/* Pricing Summary Row — hidden for roles without pricing access
          (Storekeeper, Employee, Technician, etc.). They see stock only. */}
      {showPricing && (
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-0 sm:divide-x divide-border">
            <div className="text-center sm:text-left sm:pr-6">
              <p className="text-sm text-muted-foreground">Cost Price</p>
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-amber-500 mt-0.5">
                {formatCurrency(costPrice, true)}
              </p>
            </div>
            <div className="text-center sm:text-left sm:px-6">
              <p className="text-sm text-muted-foreground">Sell Price</p>
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-emerald-500 mt-0.5">
                {formatCurrency(sellPrice, true)}
              </p>
            </div>
            <div className="text-center sm:text-left sm:pl-6">
              <p className="text-sm text-muted-foreground">Inventory Value</p>
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-primary mt-0.5">
                {formatCurrency(inventoryValue, true)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Product Quick Info */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Hash className="size-4" />
          <span className="font-mono">{product.SKU}</span>
          <button
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Copy SKU"
          >
            <Copy className="size-3" />
          </button>
        </div>
        {product.category && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Tag className="size-4" />
            <span>
              {typeof product.category === "object"
                ? product.category.name
                : product.category}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Package className="size-4" />
          <span>{product.unit || "pcs"}</span>
        </div>
        {product.barcode && (
          <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs">
            {product.barcode}
          </div>
        )}
      </div>

      {/* Description */}
      {product.description && (
        <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
          {product.description}
        </p>
      )}

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Inventory Details */}
          <SectionCard title="Inventory" icon={Warehouse}>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
              <div>
                <DataRow label="Quantity on Hand" value={formatNumber(qty)} />
                <DataRow label="Committed" value={formatNumber(committed)} />
                <DataRow label="Available" value={formatNumber(available)} />
                {showPricing && (
                  <DataRow
                    label="Inventory Value"
                    value={formatCurrency(inventoryValue)}
                  />
                )}
              </div>
              <div>
                <DataRow
                  label="Reorder Level"
                  value={formatNumber(product.inventory?.reorderLevel || 0)}
                />
                <DataRow
                  label="Reorder Quantity"
                  value={formatNumber(product.inventory?.reorderQuantity || 0)}
                />
                <DataRow
                  label="Min Stock"
                  value={formatNumber(product.inventory?.minimumStock || 0)}
                />
                <DataRow
                  label="Max Stock"
                  value={formatNumber(product.inventory?.maximumStock || 0)}
                />
              </div>
            </div>
          </SectionCard>

          {/* Costing & Pricing — hidden entirely for roles without pricing
              access (Storekeeper, Employee, Technician, etc.) */}
          {showPricing && (
          <SectionCard
            title="Costing & Pricing"
            icon={DollarSign}
            action={
              canEditPrice ? (
                <PricingDialog
                  product={{
                    _id: product._id,
                    SKU: product.SKU,
                    name: product.name,
                    costing: {
                      costPrice: product.costing?.costPrice || 0,
                    },
                    pricing: {
                      priceMode: product.pricing?.priceMode || "manual",
                      sellingPrice: product.pricing?.sellingPrice || 0,
                      markupPercentage:
                        product.pricing?.markupPercentage || 0,
                      minimumPrice: product.pricing?.minimumPrice || 0,
                    },
                  }}
                />
              ) : null
            }
          >
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Cost
                </p>
                <DataRow
                  label="Average Cost"
                  value={formatCurrency(costPrice)}
                  mono
                />
                <DataRow
                  label="Last Purchase"
                  value={formatCurrency(product.costing?.lastPurchaseCost)}
                  mono
                />
                <DataRow
                  label="Standard Cost"
                  value={formatCurrency(product.costing?.standardCost)}
                  mono
                />
                <DataRow
                  label="Costing Method"
                  value={product.costing?.costingMethod || "average"}
                />
                <DataRow
                  label="Last Purchase Date"
                  value={formatDate(product.costing?.lastPurchaseDate)}
                />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Pricing
                </p>
                <DataRow
                  label="Selling Price"
                  value={formatCurrency(sellPrice)}
                  mono
                />
                <DataRow
                  label="Wholesale Price"
                  value={formatCurrency(product.pricing?.wholesalePrice)}
                  mono
                />
                <DataRow
                  label="Minimum Price"
                  value={formatCurrency(product.pricing?.minimumPrice)}
                  mono
                />
                <DataRow
                  label="Margin"
                  value={`${margin.toFixed(1)}%`}
                  valueColor="text-emerald-500"
                />
                <DataRow
                  label="Markup"
                  value={`${(product.pricing?.markupPercentage || 0).toFixed(
                    1
                  )}%`}
                  valueColor="text-blue-500"
                />
              </div>
            </div>

            {/* Cost Breakdown */}
            {product.costing?.costBreakdown && (
              <div className="mt-6 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Cost Breakdown
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                  {[
                    {
                      label: "Base Cost",
                      value: product.costing.costBreakdown.baseCost,
                    },
                    {
                      label: "Freight",
                      value: product.costing.costBreakdown.freight,
                    },
                    {
                      label: "Duties",
                      value: product.costing.costBreakdown.duties,
                    },
                    {
                      label: "Handling",
                      value: product.costing.costBreakdown.handling,
                    },
                    {
                      label: "Other",
                      value: product.costing.costBreakdown.other,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="text-center p-3 rounded-lg bg-muted/50"
                    >
                      <p className="text-sm font-mono font-medium text-foreground">
                        {formatCurrency(item.value || 0)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
          )}

          {/* Lifetime Performance — also pricing-derived (revenue/COGS/profit),
              gate behind pricing access. */}
          {showPricing && (
          <SectionCard title="Lifetime Performance" icon={Activity}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  label: "Units Sold",
                  value: formatNumber(
                    product.lifetimeTotals?.totalQuantitySold || 0
                  ),
                  icon: ShoppingCart,
                  color: "text-blue-500",
                },
                {
                  label: "Revenue",
                  value: formatCurrency(
                    product.lifetimeTotals?.totalRevenue || 0,
                    true
                  ),
                  icon: TrendingUp,
                  color: "text-emerald-500",
                },
                {
                  label: "COGS",
                  value: formatCurrency(
                    product.lifetimeTotals?.totalCOGS || 0,
                    true
                  ),
                  icon: Receipt,
                  color: "text-amber-500",
                },
                {
                  label: "Gross Profit",
                  value: formatCurrency(
                    product.lifetimeTotals?.totalGrossProfit || 0,
                    true
                  ),
                  icon: BarChart3,
                  color: "text-primary",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="text-center p-3 rounded-lg bg-muted/30"
                >
                  <stat.icon className={`size-5 mx-auto ${stat.color} mb-2`} />
                  <p className="text-lg sm:text-xl font-semibold text-foreground">
                    {stat.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          </SectionCard>
          )}

          {/* Accounting & Tax — gate behind pricing access (account mappings
              are commercial/finance data, not for storekeepers). */}
          {showPricing && (
          <SectionCard title="Accounting & Tax" icon={FileText}>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
              <div>
                <DataRow
                  label="Inventory Account"
                  value={
                    product.accounting?.inventoryAccountCode
                      ? `${product.accounting.inventoryAccountCode} - ${product.accounting.inventoryAccountName}`
                      : "Not configured"
                  }
                />
                <DataRow
                  label="COGS Account"
                  value={
                    product.accounting?.cogsAccountCode
                      ? `${product.accounting.cogsAccountCode} - ${product.accounting.cogsAccountName}`
                      : "Not configured"
                  }
                />
                <DataRow
                  label="Revenue Account"
                  value={
                    product.accounting?.revenueAccountCode
                      ? `${product.accounting.revenueAccountCode} - ${product.accounting.revenueAccountName}`
                      : "Not configured"
                  }
                />
              </div>
              <div>
                <DataRow
                  label="Tracked in Accounting"
                  value={product.accounting?.trackedInAccounting ? "Yes" : "No"}
                />
                <DataRow
                  label="Taxable"
                  value={product.taxInfo?.taxable ? "Yes" : "No"}
                />
                <DataRow
                  label="Tax Rate"
                  value={
                    product.taxInfo?.taxRate
                      ? `${product.taxInfo.taxRate}% VAT`
                      : "—"
                  }
                />
              </div>
            </div>
          </SectionCard>
          )}

          {/* Additional Info */}
          <SectionCard title="Additional Information" icon={Building2}>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Supplier
                </p>
                <DataRow label="Name" value={product.supplier?.name} />
                <DataRow
                  label="Contact"
                  value={product.supplier?.contactPerson}
                />
                <DataRow label="Phone" value={product.supplier?.phone} />
                <DataRow label="Email" value={product.supplier?.email} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Manufacturer
                </p>
                <DataRow label="Name" value={product.manufacturer?.name} />
                <DataRow
                  label="Part Number"
                  value={product.manufacturer?.partNumber}
                  mono
                />
              </div>
            </div>

            {/* Tags */}
            {product.tags?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {product.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg bg-muted text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {product.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Notes
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {product.notes}
                </p>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right Column - Activity */}
        <div className="space-y-4 sm:space-y-6">
          {/* Recent Movements */}
          <SectionCard
            title="Recent Movements"
            icon={History}
            action={
              <Link
                href={`/stock-movements?product=${id}`}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all
              </Link>
            }
          >
            {movements.length > 0 ? (
              <div className="-my-1">
                {movements.map((movement) => (
                  <MovementRow key={movement._id} movement={movement} />
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground text-center">
                No movements yet
              </p>
            )}
          </SectionCard>

          {/* Pending Requests */}
          <SectionCard
            title="Pending Requests"
            icon={Layers}
            action={
              <Link
                href={`/stock-requests?product=${id}`}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all
              </Link>
            }
          >
            {requests.length > 0 ? (
              <div className="-my-1">
                {requests.map((request) => (
                  <RequestRow key={request._id} request={request} />
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground text-center">
                No pending requests
              </p>
            )}
          </SectionCard>

          {/* Active Checkouts */}
          {checkouts.length > 0 && (
            <SectionCard
              title="Active Checkouts"
              icon={Link2}
              action={
                <Link
                  href={`/checkouts?product=${id}`}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all
                </Link>
              }
            >
              <div className="-my-1">
                {checkouts.map((checkout) => (
                  <CheckoutRow key={checkout._id} checkout={checkout} />
                ))}
              </div>
            </SectionCard>
          )}

          {/* Quick Actions - Mobile */}
          <div className="sm:hidden rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Quick Actions
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/stock-adjustments/new?product=${id}`}>
                  <Scale className="size-4 mr-1.5" />
                  Adjust
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/stock-requests/new?product=${id}`}>
                  <Layers className="size-4 mr-1.5" />
                  Request
                </Link>
              </Button>
            </div>
          </div>

          {/* Record Metadata */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Record Info
            </p>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Created</span>
                <span className="text-foreground">
                  {formatDate(product.createdAt)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>By</span>
                <span className="text-foreground">
                  {product.createdBy?.name || "System"}
                </span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-muted-foreground">
                <span>Modified</span>
                <span className="text-foreground">
                  {formatDate(product.updatedAt)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>By</span>
                <span className="text-foreground">
                  {product.lastModifiedBy?.name || "System"}
                </span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-muted-foreground">
                <span>ID</span>
                <span className="font-mono text-foreground">
                  {String(product._id).slice(-8)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
