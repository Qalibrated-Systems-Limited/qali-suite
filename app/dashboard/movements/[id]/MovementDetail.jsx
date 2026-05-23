import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  Package,
  User,
  Calendar,
  FileText,
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
} from "lucide-react";

const TYPE_STYLES = {
  issue: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  return: "bg-green-500/10 text-green-500 border-green-500/20",
  sale: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  purchase: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  adjustment: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  damage: "bg-red-500/10 text-red-500 border-red-500/20",
  transfer: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  initial:
    "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20",
};

const TYPE_LABELS = {
  issue: "Issue",
  return: "Return",
  sale: "Sale",
  purchase: "Purchase",
  adjustment: "Adjustment",
  damage: "Damage",
  transfer: "Transfer",
  initial: "Initial",
};

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

function formatCurrency(amount) {
  const n = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(n);
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" />}
        {title}
      </h3>
      <div className="space-y-2 p-4 bg-muted/50 rounded-lg border border-border">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, mono = false, accent }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p
        className={`text-sm ${mono ? "font-mono" : ""} ${accent || "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

export function MovementDetail({ movement }) {
  const typeStyle = TYPE_STYLES[movement.movementType] || TYPE_STYLES.initial;
  const typeLabel = TYPE_LABELS[movement.movementType] || movement.movementType;
  const movementValue =
    movement.totalValue ||
    movement.costing?.totalValue ||
    movement.costing?.totalCost ||
    0;

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/movements"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Stock Movements
        </Link>
        <span>/</span>
        <span className="text-foreground font-mono">
          {movement.movementNumber}
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {movement.productSnapshot?.name || "Movement"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {movement.movementNumber}
            {movement.productSnapshot?.SKU
              ? ` · ${movement.productSnapshot.SKU}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={typeStyle}>
            {typeLabel}
          </Badge>
          <Badge
            variant="outline"
            className={
              movement.direction === "in"
                ? "bg-green-500/10 text-green-500 border-green-500/20"
                : "bg-red-500/10 text-red-500 border-red-500/20"
            }
          >
            {movement.direction === "in" ? (
              <ArrowDownCircle className="mr-1 h-3 w-3" />
            ) : (
              <ArrowUpCircle className="mr-1 h-3 w-3" />
            )}
            Stock {movement.direction === "in" ? "In" : "Out"}
          </Badge>
        </div>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-4">
            <Section icon={Package} title="Product Information">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field
                  label="Product"
                  value={movement.productSnapshot?.name}
                />
                <Field
                  label="SKU"
                  value={movement.productSnapshot?.SKU}
                  mono
                />
                <Field
                  label="Category"
                  value={movement.productSnapshot?.category}
                />
                <Field label="Serial Number" value={movement.serialNo} mono />
              </div>
            </Section>

            <Separator className="bg-border" />

            <Section icon={DollarSign} title="Quantity & Value">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Quantity
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {movement.quantity}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Unit Price
                  </p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatCurrency(movement.unitPrice || 0)}
                  </p>
                </div>
                <Field
                  label="Previous Stock"
                  value={String(movement.previousStock ?? "—")}
                />
                <Field
                  label="New Stock"
                  value={String(movement.newStock ?? "—")}
                />
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">
                    Total Value
                  </p>
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {formatCurrency(movementValue)}
                  </p>
                </div>
              </div>
            </Section>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-4">
            <Section icon={User} title="Performed By">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Name" value={movement.performedBy?.name} />
                <Field label="Role" value={movement.performedBy?.role} />
              </div>
            </Section>

            {movement.issuedTo?.name && (
              <>
                <Separator className="bg-border" />
                <Section icon={User} title="Issued To">
                  <Field label="Name" value={movement.issuedTo.name} />
                  <Field
                    label="Department"
                    value={movement.issuedTo.department}
                  />
                  <Field label="Purpose" value={movement.issuedTo.purpose} />
                </Section>
              </>
            )}

            {movement.returnedBy?.name && (
              <>
                <Separator className="bg-border" />
                <Section icon={User} title="Returned By">
                  <Field label="Name" value={movement.returnedBy.name} />
                  {movement.returnedBy.condition && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Condition
                      </p>
                      <Badge variant="outline" className="capitalize">
                        {movement.returnedBy.condition}
                      </Badge>
                    </div>
                  )}
                  <Field
                    label="Notes"
                    value={movement.returnedBy.conditionNotes}
                  />
                </Section>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Timeline + Details */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <Section icon={Calendar} title="Timeline & Details">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Movement Date</span>
                <span className="text-foreground">
                  {formatDateTime(movement.createdAt)}
                </span>
              </div>
              {movement.requiresReturn && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Requires Return
                    </span>
                    <Badge
                      variant="outline"
                      className="bg-orange-500/10 text-orange-500 border-orange-500/20"
                    >
                      Yes
                    </Badge>
                  </div>
                  {movement.expectedReturnDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Expected Return
                      </span>
                      <span className="text-foreground">
                        {formatDateTime(movement.expectedReturnDate)}
                      </span>
                    </div>
                  )}
                  {movement.actualReturnDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Actual Return
                      </span>
                      <span className="text-foreground">
                        {formatDateTime(movement.actualReturnDate)}
                      </span>
                    </div>
                  )}
                </>
              )}
              {movement.fromLocation && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">From Location</span>
                  <span className="text-foreground">
                    {movement.fromLocation}
                  </span>
                </div>
              )}
              {movement.toLocation && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">To Location</span>
                  <span className="text-foreground">
                    {movement.toLocation}
                  </span>
                </div>
              )}
            </div>
          </Section>
        </CardContent>
      </Card>

      {/* Notes / reason */}
      {(movement.notes || movement.reason) && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <Section icon={FileText} title="Notes & Reason">
              <Field label="Reason" value={movement.reason} />
              <Field label="Notes" value={movement.notes} />
            </Section>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
