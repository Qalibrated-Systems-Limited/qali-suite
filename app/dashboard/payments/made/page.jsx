import { Suspense } from "react";
import Link from "next/link";
import {
  Plus,
  Wallet,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowUpRight,
  Banknote,
  Smartphone,
  Building2,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Search from "@/components/search";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";
import { getPayments, getPaymentStats } from "@/app/mongodb/actions/payment-actions";
import { auth } from "@/auth";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { PaymentActions } from "../components/PaymentActions";

export const metadata = {
  title: "Payments Made | ERP",
  description: "Track payments made to suppliers",
};

function StatusBadge({ status }) {
  const config = {
    draft: { label: "Draft", className: "bg-secondary text-secondary-foreground", icon: Clock },
    pending_clearance: { label: "Pending", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400", icon: Clock },
    confirmed: { label: "Confirmed", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
    cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground", icon: XCircle },
  };
  const { label, className, icon: Icon } = config[status] || config.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function MethodIcon({ method }) {
  const icons = { cash: Banknote, mpesa: Smartphone, bank_transfer: Building2, cheque: CreditCard, card: CreditCard };
  const Icon = icons[method] || CreditCard;
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}

async function StatsCards() {
  const result = await getPaymentStats();
  const stats = result.success ? result.data : {};

  const cards = [
    { label: "This Month Paid", value: stats.thisMonth?.made?.count || 0, amount: stats.thisMonth?.made?.total || 0, icon: ArrowUpRight, iconColor: "text-red-500", iconBg: "bg-red-500/10" },
    { label: "Draft", value: stats.byStatus?.draft || 0, icon: Clock, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
    { label: "Unreconciled", value: stats.unreconciledCount || 0, icon: Wallet, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
    { label: "Confirmed", value: stats.byStatus?.confirmed || 0, icon: CheckCircle2, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className={`rounded-md p-2 ${card.iconBg}`}>
              <card.icon className={`h-4 w-4 ${card.iconColor}`} />
            </div>
            <span className="text-2xl font-bold">{card.value}</span>
          </div>
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            {card.amount !== undefined && (
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(card.amount, true)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentsTable({ payments, userRole }) {
  if (payments.length === 0) {
    return (
      <div className="hidden md:block rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Wallet className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No payments found</h3>
        <p className="text-sm text-muted-foreground mt-1">Record your first supplier payment.</p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/payments/create?type=made">
            <Plus className="h-4 w-4 mr-2" />
            Make Payment
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Payment #</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Supplier</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Date</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Method</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Amount</th>
            <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((p) => (
            <tr key={p._id} className="hover:bg-muted/50 transition-colors">
              <td className="px-4 py-3">
                <Link href={`/dashboard/payments/${p._id}`} className="font-medium text-primary hover:underline">
                  {p.paymentNumber}
                </Link>
                {p.reference && <p className="text-xs text-muted-foreground">Ref: {p.reference}</p>}
              </td>
              <td className="px-4 py-3 font-medium">{p.party?.name}</td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "-"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <MethodIcon method={p.paymentMethod} />
                  <span className="text-sm capitalize">{p.paymentMethod?.replace("_", " ")}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-semibold text-red-600 dark:text-red-400">-{formatCurrency(p.amount)}</span>
                {p.unappliedAmount > 0 && <p className="text-xs text-muted-foreground">Unapplied: {formatCurrency(p.unappliedAmount)}</p>}
              </td>
              <td className="px-4 py-3 text-center"><StatusBadge status={p.status} /></td>
              <td className="px-4 py-3 text-right"><PaymentActions payment={p} userRole={userRole} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsCards({ payments, userRole }) {
  if (payments.length === 0) {
    return (
      <div className="md:hidden rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Wallet className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No payments found</h3>
        <p className="text-sm text-muted-foreground mt-1">Record your first supplier payment.</p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/payments/create?type=made">
            <Plus className="h-4 w-4 mr-2" />
            Make Payment
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-3">
      {payments.map((p) => (
        <div key={p._id} className="rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors">
          <div className="flex items-start justify-between gap-4">
            <Link href={`/dashboard/payments/${p._id}`} className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-primary hover:underline">{p.paymentNumber}</span>
                <StatusBadge status={p.status} />
              </div>
              <p className="font-medium mt-1 truncate">{p.party?.name}</p>
            </Link>
            <div className="flex items-start gap-2 shrink-0">
              <p className="font-bold text-red-600 dark:text-red-400">-{formatCurrency(p.amount)}</p>
              <PaymentActions payment={p} userRole={userRole} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MethodIcon method={p.paymentMethod} />
              <span className="capitalize">{p.paymentMethod?.replace("_", " ")}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "-"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

async function PaymentsList({ searchParams, userRole }) {
  const params = await searchParams;
  const page = Number(params?.page) || 1;
  const query = params?.query || "";

  const result = await getPayments({
    paymentType: "made",
    page,
    limit: 10,
    search: query,
  });

  const payments = result.success ? result.data : [];
  const pagination = result.pagination || { page: 1, pages: 1, total: 0 };

  return (
    <>
      <PaymentsTable payments={payments} userRole={userRole} />
      <PaymentsCards payments={payments} userRole={userRole} />
      {pagination.pages > 1 && (
        <div className="mt-6">
          <Pagination totalPages={pagination.pages} />
        </div>
      )}
    </>
  );
}

export default async function PaymentsMadePage({ searchParams }) {
  const session = await auth();
  const canCreate = [...FINANCE_WRITE_ROLES, "Manager"].includes(session?.user?.role);
  const params = await searchParams;
  const successMessage = params?.success === "true" ? params?.message : null;

  return (
    <div className="space-y-6">
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{successMessage}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments Made</h1>
          <p className="text-muted-foreground">Track payments made to suppliers</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/dashboard/payments/create?type=made">
              <Plus className="h-4 w-4 mr-2" />
              Make Payment
            </Link>
          </Button>
        )}
      </div>

      <Suspense fallback={<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="h-24 rounded-lg border bg-muted animate-pulse" />)}</div>}>
        <StatsCards />
      </Suspense>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Search placeholder="Search by payment number, supplier, or reference..." />
        </div>
      </div>

      <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
        <PaymentsList searchParams={searchParams} userRole={session?.user?.role} />
      </Suspense>
    </div>
  );
}
