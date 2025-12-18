import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getInvoiceById } from "@/app/mongodb/queries/invoice-queries";
import {
  fetchActiveCustomers,
  fetchAvailableProducts,
} from "@/app/mongodb/queries/invoice-queries";
import EditInvoiceFormClient from "../../components/EditInvoiceForm";

export default async function EditInvoicePage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  if (user.role !== "Admin" && user.role !== "Accountant") {
    return (
      <div className="flex min-h-1000 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            Only Admins and Accountants can edit invoices.
          </p>
        </div>
      </div>
    );
  }

  // Fetch invoice data
  const invoice = await getInvoiceById(resolvedParams.id);

  if (!invoice) {
    notFound();
  }

  // Can't edit paid or cancelled invoices
  if (invoice.status === "paid" || invoice.status === "cancelled") {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Cannot Edit Invoice
          </h2>
          <p className="text-muted-foreground mb-4">
            {invoice.status === "paid"
              ? "Paid invoices cannot be edited."
              : "Cancelled invoices cannot be edited."}
          </p>
          <a
            href={`/dashboard/invoices/${invoice._id}`}
            className="text-yellow-600 hover:text-yellow-700 underline"
          >
            Back to invoice
          </a>
        </div>
      </div>
    );
  }

  // Fetch customers and products in parallel
  const [customers, products] = await Promise.all([
    fetchActiveCustomers(),
    fetchAvailableProducts(),
  ]);

  return (
    <EditInvoiceFormClient
      invoice={invoice}
      customers={customers}
      products={products}
      user={user}
    />
  );
}
