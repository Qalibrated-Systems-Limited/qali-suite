import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Receipt,
  Building2,
  Calendar,
  Hash,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Wallet,
  Edit,
  Trash2,
  Send,
  CreditCard,
  User,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getExpenseById } from "@/app/mongodb/queries/expense-queries";
import ExpenseActions from "../components/ExpenseActions";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const expense = await getExpenseById(id);
  return {
    title: expense
      ? `${expense.expenseNumber} | Expense`
      : "Expense Not Found",
  };
}

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount || 0);
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const formatDateTime = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const statusConfig = {
  draft: {
    label: "Draft",
    variant: "secondary",
    icon: Receipt,
    description: "Expense is saved but not submitted",
  },
  pending: {
    label: "Pending Approval",
    variant: "warning",
    icon: Clock,
    description: "Waiting for manager approval",
  },
  approved: {
    label: "Approved",
    variant: "success",
    icon: CheckCircle2,
    description: "Ready for payment",
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    icon: XCircle,
    description: "Expense was rejected",
  },
  paid: {
    label: "Paid",
    variant: "default",
    icon: Wallet,
    description: "Payment completed",
  },
};

const categoryLabels = {
  utilities: "Utilities",
  rent: "Rent & Lease",
  salaries: "Salaries & Wages",
  transport: "Transport & Fuel",
  office_supplies: "Office Supplies",
  insurance: "Insurance",
  maintenance: "Repairs & Maintenance",
  marketing: "Marketing & Advertising",
  legal_professional: "Legal & Professional Fees",
  bank_charges: "Bank Charges",
  depreciation: "Depreciation",
  meals_entertainment: "Meals & Entertainment",
  telecommunications: "Telecommunications",
  training: "Training & Development",
  other: "Other Expenses",
};

async function getPaymentAccounts() {
  await dbConnect();
  const { companyId } = await getTenantContext();

  const accounts = await Account.find({
    companyId,
    subType: { $in: ["cash", "bank", "mpesa"] },
    isActive: { $ne: false },
    canPost: true,
  })
    .select("_id accountCode accountName subType")
    .sort({ accountCode: 1 })
    .lean();

  return accounts.map((a) => ({
    _id: a._id.toString(),
    accountCode: a.accountCode,
    accountName: a.accountName,
    subType: a.subType,
  }));
}

export default async function ExpenseDetailPage({ params }) {
  const { id } = await params;
  const [expense, paymentAccounts] = await Promise.all([
    getExpenseById(id),
    getPaymentAccounts(),
  ]);

  if (!expense) {
    notFound();
  }

  const StatusIcon = statusConfig[expense.status]?.icon || Receipt;
  const statusInfo = statusConfig[expense.status];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-8 w-8 shrink-0 mt-1"
          >
            <Link href="/dashboard/expenses">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{expense.expenseNumber}</h1>
              <Badge variant={statusInfo?.variant} className="gap-1">
                <StatusIcon className="w-3 h-3" />
                {statusInfo?.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {expense.description}
            </p>
          </div>
        </div>

        {/* Actions */}
        <ExpenseActions expense={expense} paymentAccounts={paymentAccounts} />
      </div>

      {/* Rejection Reason Alert */}
      {expense.status === "rejected" && expense.rejectionReason && (
        <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Rejection Reason</p>
            <p className="text-sm text-muted-foreground mt-1">
              {expense.rejectionReason}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Rejected by {expense.rejectedBy?.name} on{" "}
              {formatDateTime(expense.rejectedAt)}
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Expense Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                Expense Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {formatDate(expense.expenseDate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Category</p>
                  <Badge variant="outline">
                    {categoryLabels[expense.category] || expense.category}
                  </Badge>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm text-muted-foreground mb-1">Description</p>
                <p>{expense.description}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-1">Expense Account</p>
                <p className="font-mono text-sm">
                  {expense.accountCode} - {expense.accountName}
                </p>
              </div>

              {(expense.reference || expense.invoiceNumber) && (
                <>
                  <Separator />
                  <div className="grid sm:grid-cols-2 gap-4">
                    {expense.reference && (
                      <div>
                        <p className="text-sm text-muted-foreground">Reference</p>
                        <p className="font-mono">{expense.reference}</p>
                      </div>
                    )}
                    {expense.invoiceNumber && (
                      <div>
                        <p className="text-sm text-muted-foreground">Invoice #</p>
                        <p className="font-mono">{expense.invoiceNumber}</p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {expense.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm">{expense.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Vendor Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Vendor / Payee
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{expense.vendor?.name || "-"}</p>
                </div>
                {expense.vendor?.taxPin && (
                  <div>
                    <p className="text-sm text-muted-foreground">KRA PIN</p>
                    <p className="font-mono">{expense.vendor.taxPin}</p>
                  </div>
                )}
                {expense.vendor?.phone && (
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p>{expense.vendor.phone}</p>
                  </div>
                )}
                {expense.vendor?.email && (
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p>{expense.vendor.email}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Reimbursement Info */}
          {expense.isReimbursable && (
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-500" />
                  Employee Reimbursement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Employee</p>
                    <p className="font-medium">{expense.employeeName || "-"}</p>
                  </div>
                  {expense.employeeId && (
                    <div>
                      <p className="text-sm text-muted-foreground">Employee ID</p>
                      <p className="font-mono">{expense.employeeId}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    {expense.reimbursedAt ? (
                      <Badge variant="success">Reimbursed</Badge>
                    ) : (
                      <Badge variant="warning">Pending Reimbursement</Badge>
                    )}
                  </div>
                  {expense.reimbursedAt && (
                    <div>
                      <p className="text-sm text-muted-foreground">Reimbursed On</p>
                      <p>{formatDate(expense.reimbursedAt)}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Amount Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Amount
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(expense.amount)}</span>
              </div>
              {expense.taxAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    VAT ({expense.taxRate}%)
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(expense.taxAmount)}
                  </span>
                </div>
              )}
              {expense.withholdingTax > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>WHT Deducted</span>
                  <span className="tabular-nums">
                    -{formatCurrency(expense.withholdingTax)}
                  </span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(expense.total)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Payment Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Method</p>
                <p className="capitalize">
                  {expense.paymentMethod === "unpaid"
                    ? "Not Paid"
                    : expense.paymentMethod?.replace("_", " ")}
                </p>
              </div>
              {expense.status === "paid" && expense.paidAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Paid On</p>
                  <p>{formatDateTime(expense.paidAt)}</p>
                </div>
              )}
              {expense.journalEntryId && (
                <div>
                  <p className="text-sm text-muted-foreground">Journal Entry</p>
                  <Link
                    href={`/dashboard/journal/${expense.journalEntryId}`}
                    className="text-primary hover:underline text-sm"
                  >
                    View Entry
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Audit Trail */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm">
                <p className="text-muted-foreground">Created</p>
                <p>
                  {expense.createdBy?.name} on {formatDateTime(expense.createdAt)}
                </p>
              </div>
              {expense.submittedAt && (
                <div className="text-sm">
                  <p className="text-muted-foreground">Submitted</p>
                  <p>
                    {expense.submittedBy?.name} on{" "}
                    {formatDateTime(expense.submittedAt)}
                  </p>
                </div>
              )}
              {expense.approvedAt && (
                <div className="text-sm">
                  <p className="text-muted-foreground">Approved</p>
                  <p>
                    {expense.approvedBy?.name} on{" "}
                    {formatDateTime(expense.approvedAt)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
