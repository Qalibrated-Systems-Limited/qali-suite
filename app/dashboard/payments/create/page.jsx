import { auth } from "@/auth";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCustomers, getSuppliers } from "@/app/mongodb/queries/partyQueries";
import { PaymentForm } from "../components/PaymentForm";

export const metadata = {
  title: "Create Payment | ERP",
  description: "Create a new payment",
};

export default async function CreatePaymentPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canCreate = [...FINANCE_WRITE_ROLES, "Manager"].includes(session.user.role);
  if (!canCreate) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">You don&apos;t have permission to create payments.</p>
      </div>
    );
  }

  const params = await searchParams;
  const paymentType = params?.type === "made" ? "made" : "received";
  const isReceived = paymentType === "received";

  // Fetch parties based on payment type
  const parties = isReceived ? await getCustomers() : await getSuppliers();

  const backUrl = isReceived
    ? "/dashboard/payments/received"
    : "/dashboard/payments/made";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isReceived ? "Receive Payment" : "Make Payment"}
          </h1>
          <p className="text-muted-foreground">
            {isReceived
              ? "Record a payment received from a customer"
              : "Record a payment made to a supplier"}
          </p>
        </div>
      </div>

      <div className="max-w-4xl">
        <PaymentForm paymentType={paymentType} parties={parties} />
      </div>
    </div>
  );
}
