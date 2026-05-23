import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getClaimById } from "@/app/mongodb/queries/claimQueries";
import { getSignedUrl } from "@/lib/cloudinary";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Calendar,
  DollarSign,
  MapPin,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Receipt,
  Paperclip,
} from "lucide-react";
import { ReceiptViewer } from "@/components/receipt-viewer";
import {
  ClaimStatusBadge,
  ClaimTypeBadge,
} from "../../components/ClaimStatusBadge";
import { ApproveClaimDialog } from "../../components/ApproveClaimDialog";
import { RejectClaimDialog } from "../../components/RejectClaimDialog";
import { PayClaimDialog } from "../../components/PayClaimDialog";
import { format } from "date-fns";

import { CloseSettlementDialog } from "../../components/CloseSettlementDialog";
import { RecordReturnDialog } from "../../components/RecordReturnDialog";
import { PayBalanceDialog } from "../../components/PayBalanceDialog";
import { RecallClaimButton } from "../../components/RecallClaimButton";
import { ResubmitClaimButton } from "../../components/ResubmitClaimButton";
import ProjectContextCard from "../../components/ProjectContextCard";
import { Suspense } from "react";
import { Banknote } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import Account from "@/app/models/account";
import { getTenantContext } from "@/lib/utils/tenant-utils";
// ============================================

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

export const metadata = {
  title: "Claim Details | ERP System",
  description: "View claim details and take actions",
};

export default async function ClaimDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = user.role?.toLowerCase();

  // Fetch claim and payment accounts in parallel
  const [claim, paymentAccounts] = await Promise.all([
    getClaimById(id),
    getPaymentAccounts(),
  ]);

  if (!claim) {
    notFound();
  }

  // Check permissions
  const isOwner = claim.employee.userId === user.id;
  const isManager = userRole === "manager" || userRole === "admin";
  const isAccountant = userRole === "accountant" || userRole === "admin";

  // Only owner, managers, and accountants can view
  if (!isOwner && !isManager && !isAccountant) {
    redirect("/dashboard/my-claims");
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    return format(new Date(date), "PPP p");
  };

  const formatDateShort = (date) => {
    if (!date) return "N/A";
    return format(new Date(date), "PP");
  };

  return (
    <div className="flex flex-col gap-6 sm:gap-8 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="hover:bg-accent shrink-0"
        >
          <Link href="/dashboard/my-claims">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground truncate">
            {claim.claimNumber}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-1">
            {claim.description}
          </p>
        </div>
      </div>

      {/* Project Context (if linked to a project) */}
      {claim.projectId && (
        <Suspense fallback={null}>
          <ProjectContextCard
            projectId={claim.projectId}
            claimAmount={claim.totalAmount}
            claimStatus={claim.status}
            expenseAccountId={
              claim.items?.[0]?.expenseAccountId || null
            }
          />
        </Suspense>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClaimStatusBadge status={claim.status} />
          <ClaimTypeBadge claimType={claim.claimType} />
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Owner can edit draft or rejected claims */}
          {isOwner &&
            (claim.status === "draft" || claim.status === "rejected") && (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="flex-1 sm:flex-none border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
              >
                <Link href={`/dashboard/claims/${claim._id}/edit`}>
                  <FileText className="w-4 h-4 mr-2" />
                  Edit
                </Link>
              </Button>
            )}

          {/* Owner can recall submitted claims back to draft */}
          {isOwner && claim.status === "submitted" && (
            <RecallClaimButton
              claimId={claim._id}
              claimNumber={claim.claimNumber}
            />
          )}

          {/* Owner can resubmit rejected claims */}
          {isOwner && claim.status === "rejected" && (
            <ResubmitClaimButton
              claimId={claim._id}
              claimNumber={claim.claimNumber}
            />
          )}

          {/* Owner can settle paid advances */}
          {isOwner &&
            claim.claimType === "advance_request" &&
            claim.status === "paid" &&
            !claim.settlementClaimId && (
              <Button
                size="sm"
                className="flex-1 sm:flex-none bg-purple-600 hover:bg-purple-700 text-white"
                asChild
              >
                <Link href={`/dashboard/claims/${claim._id}/settle`}>
                  <Receipt className="w-4 h-4 mr-2" />
                  Settle Advance
                </Link>
              </Button>
            )}

          {/* Show link to settlement if exists */}
          {claim.settlementClaimId && (
            <Button
              size="sm"
              variant="outline"
              asChild
              className="flex-1 sm:flex-none border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20"
            >
              <Link href={`/dashboard/claims/${claim.settlementClaimId}`}>
                <Receipt className="w-4 h-4 mr-2" />
                View Settlement
              </Link>
            </Button>
          )}

          {/* Manager Actions - Approve/Reject submitted claims */}
          {isManager && claim.status === "submitted" && (
            <>
              <ApproveClaimDialog
                claimId={claim._id}
                claimNumber={claim.claimNumber}
              />
              <RejectClaimDialog
                claimId={claim._id}
                claimNumber={claim.claimNumber}
              />
            </>
          )}

          {/* Accountant Actions - Pay approved claims */}
          {isAccountant &&
            claim.status === "approved" &&
            (claim.claimType === "advance_request" ||
              claim.claimType === "reimbursement") && (
              <PayClaimDialog
                claimId={claim._id}
                claimNumber={claim.claimNumber}
                claimType={claim.claimType}
                amount={claim.totalAmount}
                employeeName={claim.employee.name}
                paymentAccounts={paymentAccounts}
              />
            )}

          {/* Process Settlement - for approved advance_return claims */}
          {isAccountant &&
            claim.claimType === "advance_return" &&
            claim.status === "approved" && (
              <CloseSettlementDialog
                settlementId={claim._id}
                claimNumber={claim.claimNumber}
                advanceAmount={claim.returnDetails?.advanceAmount || 0}
                totalSpent={claim.returnDetails?.totalSpent || 0}
                balance={claim.returnDetails?.balance || 0}
                employeeName={claim.employee.name}
              />
            )}

          {/* Record Return - when employee owes company */}
          {isAccountant &&
            claim.claimType === "advance_return" &&
            claim.status === "pending_return" && (
              <RecordReturnDialog
                settlementId={claim._id}
                claimNumber={claim.claimNumber}
                balance={claim.returnDetails?.balance || 0}
                employeeName={claim.employee.name}
                paymentAccounts={paymentAccounts}
              />
            )}

          {/* Pay Balance - when company owes employee */}
          {isAccountant &&
            claim.claimType === "advance_return" &&
            claim.status === "pending_payment" && (
              <PayBalanceDialog
                settlementId={claim._id}
                claimNumber={claim.claimNumber}
                balance={claim.returnDetails?.balance || 0}
                employeeName={claim.employee.name}
                paymentAccounts={paymentAccounts}
              />
            )}
        </div>
      </div>

      {/* ============================================
          NEW: Alert Banner for Pending Actions
          ============================================ */}
      {claim.claimType === "advance_return" &&
        (claim.status === "pending_return" ||
          claim.status === "pending_payment") && (
          <div
            className={`p-4 rounded-lg border ${
              claim.status === "pending_return"
                ? "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
                : "bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800"
            }`}
          >
            <div className="flex items-start gap-3">
              {claim.status === "pending_return" ? (
                <ArrowDownLeft className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              ) : (
                <Banknote className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <p
                  className={`font-semibold ${
                    claim.status === "pending_return"
                      ? "text-orange-700 dark:text-orange-400"
                      : "text-teal-700 dark:text-teal-400"
                  }`}
                >
                  {claim.status === "pending_return"
                    ? `Awaiting Return of ${formatCurrency(
                        claim.returnDetails?.balance || 0
                      )}`
                    : `Awaiting Payment of ${formatCurrency(
                        Math.abs(claim.returnDetails?.balance || 0)
                      )}`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {claim.status === "pending_return"
                    ? `${claim.employee.name} needs to return the balance amount.`
                    : `Company needs to pay additional amount to ${claim.employee.name}.`}
                </p>
              </div>
            </div>
          </div>
        )}
      {/* ============================================ */}

      {/* Main Info Card */}
      <Card className="p-5 sm:p-6 lg:p-8">
        <div className="space-y-6">
          {/* Amount - Prominent */}
          <div className="p-5 sm:p-6 bg-linear-t from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-xl border-2 border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center gap-3 mb-2">
              <DollarSign className="w-6 h-6 sm:w-7 sm:h-7 text-yellow-600 dark:text-yellow-400" />
              <p className="text-sm sm:text-base text-muted-foreground font-medium">
                Total Amount
              </p>
            </div>
            <p className="text-3xl sm:text-4xl lg:text-5xl font-bold text-yellow-700 dark:text-yellow-400">
              {formatCurrency(claim.totalAmount)}
            </p>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
            {/* Employee */}
            <div className="space-y-2">
              <p className="text-xs sm:text-sm text-muted-foreground font-medium flex items-center gap-2">
                <User className="w-4 h-4" />
                Employee
              </p>
              <p className="text-sm sm:text-base font-semibold text-foreground">
                {claim.employee.name}
              </p>
              {claim.employee.department && (
                <p className="text-xs text-muted-foreground">
                  {claim.employee.department}
                </p>
              )}
            </div>

            {/* Claim Date */}
            <div className="space-y-2">
              <p className="text-xs sm:text-sm text-muted-foreground font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Claim Date
              </p>
              <p className="text-sm sm:text-base font-semibold text-foreground">
                {formatDateShort(claim.claimDate)}
              </p>
            </div>

            {/* Destination (for advances) */}
            {claim.claimType === "advance_request" &&
              claim.advanceDetails?.destination && (
                <div className="space-y-2 sm:col-span-2">
                  <p className="text-xs sm:text-sm text-muted-foreground font-medium flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Destination
                  </p>
                  <p className="text-sm sm:text-base font-semibold text-foreground">
                    {claim.advanceDetails.destination}
                  </p>
                </div>
              )}

            {/* Travel Dates (for advances) */}
            {claim.claimType === "advance_request" &&
              claim.advanceDetails?.travelDates && (
                <>
                  <div className="space-y-2">
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">
                      Travel Start
                    </p>
                    <p className="text-sm sm:text-base font-semibold text-foreground">
                      {formatDateShort(claim.advanceDetails.travelDates.from)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">
                      Travel End
                    </p>
                    <p className="text-sm sm:text-base font-semibold text-foreground">
                      {formatDateShort(claim.advanceDetails.travelDates.to)}
                    </p>
                  </div>
                </>
              )}

            {/* Purpose (for advances) */}
            {claim.claimType === "advance_request" &&
              claim.advanceDetails?.purpose && (
                <div className="space-y-2 sm:col-span-2">
                  <p className="text-xs sm:text-sm text-muted-foreground font-medium">
                    Purpose
                  </p>
                  <p className="text-sm sm:text-base text-foreground">
                    {claim.advanceDetails.purpose}
                  </p>
                </div>
              )}
          </div>

          {/* Notes */}
          {claim.notes && (
            <div className="pt-5 border-t space-y-2">
              <p className="text-xs sm:text-sm text-muted-foreground font-medium">
                Additional Notes
              </p>
              <p className="text-sm sm:text-base text-foreground">
                {claim.notes}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Expense Items (for reimbursements) */}
      {claim.claimType === "reimbursement" &&
        claim.items &&
        claim.items.length > 0 && (
          <Card className="p-5 sm:p-6 lg:p-8">
            <h3 className="text-lg sm:text-xl font-bold text-foreground mb-5 flex items-center gap-2">
              <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
              Expense Items
            </h3>
            <div className="space-y-4">
              {claim.items.map((item, index) => (
                <div
                  key={index}
                  className="p-4 sm:p-5 bg-muted/50 rounded-lg border border-border"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1">
                      <p className="font-semibold text-sm sm:text-base text-foreground mb-1">
                        {item.description}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs sm:text-sm text-muted-foreground">
                        <Badge variant="outline" className="capitalize">
                          {item.category.replace("_", " ")}
                        </Badge>
                        <span>•</span>
                        <span>{formatDateShort(item.date)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg sm:text-xl font-bold text-foreground">
                        {formatCurrency(item.amount)}
                      </p>
                    </div>
                  </div>
                  {item.notes && (
                    <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                      {item.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

      {/* Breakdown Section (for advances with estimated expenses) */}
      {claim.claimType === "advance_request" &&
        claim.advanceDetails?.estimatedExpenses && (
          <Card className="p-5 sm:p-6 lg:p-8">
            <h3 className="text-lg sm:text-xl font-bold text-foreground mb-5 flex items-center gap-2">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
              Estimated Breakdown
            </h3>
            <div className="p-4 sm:p-5 bg-muted/50 rounded-lg border border-border">
              <pre className="text-sm sm:text-base text-foreground whitespace-pre-wrap font-mono">
                {claim.advanceDetails.estimatedExpenses}
              </pre>
            </div>
          </Card>
        )}

      {/* Settlement Details (for advance returns) */}
      {claim.claimType === "advance_return" && claim.returnDetails && (
        <Card className="p-5 sm:p-6 lg:p-8">
          <h3 className="text-lg sm:text-xl font-bold text-foreground mb-5 flex items-center gap-2">
            <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
            Settlement Details
          </h3>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs sm:text-sm text-muted-foreground mb-1">
                Advance Amount
              </p>
              <p className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-400">
                {formatCurrency(claim.returnDetails.advanceAmount)}
              </p>
            </div>
            <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-xs sm:text-sm text-muted-foreground mb-1">
                Total Spent
              </p>
              <p className="text-xl sm:text-2xl font-bold text-purple-700 dark:text-purple-400">
                {formatCurrency(claim.returnDetails.totalSpent)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg border ${
                claim.returnDetails.balance > 0
                  ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  : claim.returnDetails.balance < 0
                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                  : "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800"
              }`}
            >
              <p className="text-xs sm:text-sm text-muted-foreground mb-1">
                Balance
              </p>
              <p
                className={`text-xl sm:text-2xl font-bold ${
                  claim.returnDetails.balance > 0
                    ? "text-red-700 dark:text-red-400"
                    : claim.returnDetails.balance < 0
                    ? "text-green-700 dark:text-green-400"
                    : "text-gray-700 dark:text-gray-400"
                }`}
              >
                {formatCurrency(Math.abs(claim.returnDetails.balance))}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {claim.returnDetails.balance > 0
                  ? "To be returned"
                  : claim.returnDetails.balance < 0
                  ? "Owed to employee"
                  : "Fully settled"}
              </p>
            </div>
          </div>

          {/* Expense Items */}
          {claim.items && claim.items.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm sm:text-base text-foreground mb-3">
                Actual Expenses
              </h4>
              <div className="space-y-3">
                {claim.items.map((item, index) => (
                  <div
                    key={index}
                    className="p-4 bg-muted/50 rounded-lg border border-border"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm sm:text-base text-foreground mb-1">
                          {item.description}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs sm:text-sm text-muted-foreground">
                          <Badge variant="outline" className="capitalize">
                            {item.category.replace("_", " ")}
                          </Badge>
                          <span>•</span>
                          <span>{formatDateShort(item.date)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-base sm:text-lg font-bold text-foreground">
                          {formatCurrency(item.amount)}
                        </p>
                      </div>
                    </div>
                    {item.notes && (
                      <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                        {item.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Receipts & Attachments */}
      {claim.receipts?.length > 0 && (
        <Card className="p-5 sm:p-6 lg:p-8">
          <h3 className="text-lg sm:text-xl font-bold text-foreground mb-5 flex items-center gap-2">
            <Paperclip className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
            Receipts & Attachments
            <Badge variant="secondary" className="ml-auto">
              {claim.receipts.length}
            </Badge>
          </h3>
          <ReceiptViewer
            receipts={claim.receipts.map((r) => ({
              ...r,
              viewUrl:
                r.mimeType === "application/pdf" ||
                r.url?.toLowerCase().endsWith(".pdf")
                  ? getSignedUrl(r)
                  : r.url,
            }))}
          />
        </Card>
      )}

      {/* Timeline */}
      <Card className="p-5 sm:p-6 lg:p-8">
        <h3 className="text-lg sm:text-xl font-bold text-foreground mb-6 flex items-center gap-2">
          <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
          Activity Timeline
        </h3>
        <div className="space-y-5">
          {/* Created */}
          <div className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
              <div className="w-0.5 h-full bg-border mt-2" />
            </div>
            <div className="flex-1 pb-5">
              <p className="text-sm sm:text-base font-semibold text-foreground">
                Claim Created
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {formatDate(claim.createdAt)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                by {claim.createdBy?.name || "Unknown"}
              </p>
            </div>
          </div>

          {/* Submitted */}
          {claim.submittedAt && (
            <div className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-yellow-500 flex-shrink-0" />
                {(claim.approvedAt || claim.rejectedAt) && (
                  <div className="w-0.5 h-full bg-border mt-2" />
                )}
              </div>
              <div className="flex-1 pb-5">
                <p className="text-sm sm:text-base font-semibold text-foreground">
                  Submitted for Approval
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {formatDate(claim.submittedAt)}
                </p>
                {claim.submittedBy && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    by {claim.submittedBy.name}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Approved */}
          {claim.approvedAt && (
            <div className="flex gap-4">
              <div className="flex flex-col items-center">
                <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                {claim.paidAt && (
                  <div className="w-0.5 h-full bg-border mt-2" />
                )}
              </div>
              <div className="flex-1 pb-5">
                <p className="text-sm sm:text-base font-semibold text-foreground">
                  Approved
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {formatDate(claim.approvedAt)}
                </p>
                {claim.approvedBy && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    by {claim.approvedBy.name}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Rejected */}
          {claim.rejectedAt && (
            <div className="flex gap-4">
              <div className="flex flex-col items-center">
                <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
              </div>
              <div className="flex-1">
                <p className="text-sm sm:text-base font-semibold text-foreground">
                  Rejected
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {formatDate(claim.rejectedAt)}
                </p>
                {claim.rejectedBy && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    by {claim.rejectedBy.name}
                  </p>
                )}
                {claim.rejectionReason && (
                  <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-xs sm:text-sm text-red-700 dark:text-red-300">
                      <strong>Reason:</strong> {claim.rejectionReason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Paid */}
          {claim.paidAt && (
            <div className="flex gap-4">
              <div className="flex flex-col items-center">
                <CheckCircle2 className="w-3 h-3 text-purple-500 flex-shrink-0" />
              </div>
              <div className="flex-1">
                <p className="text-sm sm:text-base font-semibold text-foreground">
                  Payment Processed
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {formatDate(claim.paidAt)}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
