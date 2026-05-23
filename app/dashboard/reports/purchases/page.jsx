import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { canSeePurchasesNav } from "@/lib/permissions";
import { getSupplierPurchaseReport } from "@/app/mongodb/queries/supplier-report-queries";
import { PurchaseReportClient } from "./PurchaseReportClient";
import { ReportSkeleton } from "../components/ReportSkeleton";

export const metadata = {
  title: "Purchase Report | Reports",
  description: "Top suppliers by spend, outstanding payables, and spend by category",
};

async function PurchaseReport({ startDate, endDate }) {
  const data = await getSupplierPurchaseReport(startDate, endDate);
  return (
    <PurchaseReportClient
      initial={data}
      initialStart={startDate}
      initialEnd={endDate}
    />
  );
}

export default async function PurchaseReportPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeePurchasesNav(session.user.role)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const defaultEnd = now.toISOString().split("T")[0];
  const startDate = params?.startDate || defaultStart;
  const endDate = params?.endDate || defaultEnd;

  return (
    <Suspense key={`${startDate}-${endDate}`} fallback={<ReportSkeleton />}>
      <PurchaseReport startDate={startDate} endDate={endDate} />
    </Suspense>
  );
}
