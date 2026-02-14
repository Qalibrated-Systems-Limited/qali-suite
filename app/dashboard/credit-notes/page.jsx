import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  CreditNoteStatsCards,
  CreditNoteStatsSkeleton,
  CreditNotesTableServer,
  CreditNotesTableSkeleton,
} from "./components/CreditNoteServerComponents";

export const metadata = {
  title: "Credit Notes | ERP System",
  description: "Manage credit notes",
};

export default async function CreditNotesPage({ searchParams }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  if (!["Admin", "Accountant"].includes(user.role)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            Only Admins and Accountants can view credit notes.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const filters = {
    status: params.status || "all",
    search: params.search || "",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Credit Notes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage customer credit notes and refunds
          </p>
        </div>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<CreditNoteStatsSkeleton />}>
        <CreditNoteStatsCards />
      </Suspense>

      {/* Credit Notes Table - Stream independently */}
      <Suspense fallback={<CreditNotesTableSkeleton />}>
        <CreditNotesTableServer filters={filters} />
      </Suspense>
    </div>
  );
}
