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
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { CheckoutActions } from "./CheckoutActions";

const STATUS_STYLES = {
  checked_out: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  returned: "bg-green-500/10 text-green-500 border-green-500/20",
  overdue: "bg-red-500/10 text-red-500 border-red-500/20",
  lost: "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20",
  damaged: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  converted_to_sale: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  expensed: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

function formatDateTime(iso) {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleString("en-KE", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
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

export function CheckoutDetail({ checkout, canManage }) {
  const canReturn = canManage && checkout.status === "checked_out";
  const canEscalate =
    canManage &&
    checkout.status === "checked_out" &&
    checkout.isOverdue &&
    !checkout.isEscalated;
  const canExpense =
    canManage &&
    checkout.status === "checked_out" &&
    ["return_to_store", "internal_use"].includes(checkout.purpose);

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/checkout"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Item Checkouts
        </Link>
        <span>/</span>
        <span className="text-foreground font-mono">
          {checkout.checkoutNumber}
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {checkout.productSnapshot?.name || "Checkout"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {checkout.checkoutNumber} ·{" "}
            {checkout.productSnapshot?.SKU || "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_STYLES[checkout.status]}>
            {checkout.status.replace(/_/g, " ").toUpperCase()}
          </Badge>
          {checkout.isOverdue &&
            ["checked_out", "overdue"].includes(checkout.status) && (
              <Badge
                variant="outline"
                className="bg-red-500/10 text-red-500 border-red-500/20"
              >
                {checkout.daysOverdue} days overdue
              </Badge>
            )}
        </div>
      </div>

      <CheckoutActions
        checkout={checkout}
        canReturn={canReturn}
        canEscalate={canEscalate}
        canExpense={canExpense}
      />

      {/* Two-column layout on desktop */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-4">
            <Section icon={Package} title="Product Information">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Product" value={checkout.productSnapshot?.name} />
                <Field
                  label="SKU"
                  value={checkout.productSnapshot?.SKU}
                  mono
                />
                <Field label="Quantity" value={checkout.quantity} />
                <Field label="Serial Number" value={checkout.serialNo} mono />
              </div>
            </Section>

            <Separator className="bg-border" />

            <Section icon={User} title="Checked Out To">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Name" value={checkout.checkedOutTo?.name} />
                <Field
                  label="Department"
                  value={checkout.checkedOutTo?.department}
                />
                <Field label="Email" value={checkout.checkedOutTo?.email} />
                <Field label="Phone" value={checkout.checkedOutTo?.phone} />
              </div>
            </Section>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-4">
            <Section icon={Calendar} title="Timeline">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Checkout Date</span>
                  <span className="text-foreground">
                    {formatDateTime(checkout.checkoutDate)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expected Return</span>
                  <span className="text-foreground">
                    {formatDateTime(checkout.expectedReturnDate)}
                  </span>
                </div>
                {checkout.returnedDate && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Actual Return</span>
                    <span className="text-foreground">
                      {formatDateTime(checkout.returnedDate)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Checked Out By</span>
                  <span className="text-foreground">
                    {checkout.checkedOutBy?.name}
                  </span>
                </div>
                {checkout.returnedBy && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Returned By</span>
                    <span className="text-foreground">
                      {checkout.returnedBy.name}
                    </span>
                  </div>
                )}
              </div>
            </Section>

            <Separator className="bg-border" />

            <Section icon={FileText} title="Details">
              <Field
                label="Purpose"
                value={checkout.purpose?.replace(/_/g, " ")}
              />
              <Field label="Purpose Details" value={checkout.purposeDetails} />
              <Field label="Checkout Notes" value={checkout.checkoutNotes} />
            </Section>
          </CardContent>
        </Card>
      </div>

      {/* Return information (only when returned) */}
      {checkout.status === "returned" && checkout.returnCondition && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <Section icon={RotateCcw} title="Return Information">
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Return Condition
                </p>
                <Badge
                  variant="outline"
                  className="bg-green-500/10 text-green-500 border-green-500/20"
                >
                  {checkout.returnCondition}
                </Badge>
              </div>
              <Field label="Return Notes" value={checkout.returnNotes} />
              <Field
                label="Damage Details"
                value={checkout.damageDetails}
                accent="text-orange-400"
              />
            </Section>
          </CardContent>
        </Card>
      )}

      {/* Escalation */}
      {checkout.isEscalated && checkout.escalatedTo && (
        <Card className="bg-card border-red-500/20">
          <CardContent className="p-4">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-red-500 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Escalated
              </h3>
              <div className="space-y-2 p-4 bg-red-500/5 rounded-lg border border-red-500/20">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Escalated To</span>
                  <span className="text-foreground">
                    {checkout.escalatedTo.name}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Escalated At</span>
                  <span className="text-foreground">
                    {formatDateTime(checkout.escalatedTo.escalatedAt)}
                  </span>
                </div>
                <Field label="Reason" value={checkout.escalatedTo.reason} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
