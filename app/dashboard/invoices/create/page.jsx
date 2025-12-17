import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  fetchActiveCustomers,
  fetchAvailableProducts,
} from "@/app/mongodb/invoice-queries";
import CreateInvoiceFormClient from "../components/CreateInvoiceForm";

export default async function CreateInvoicePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  if (user.role !== "Admin" && user.role !== "Accountant") {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            Only Admins and Accountants can create invoices.
          </p>
        </div>
      </div>
    );
  }

  // Fetch customers and products
  const [customers, products] = await Promise.all([
    fetchActiveCustomers(),
    fetchAvailableProducts(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">Create Invoice</h1>
        <p className="text-muted-foreground">
          Generate a new invoice for direct sales
        </p>
      </div>

      {/* Form */}
      <CreateInvoiceFormClient customers={customers} products={products} />
    </div>
  );
}
