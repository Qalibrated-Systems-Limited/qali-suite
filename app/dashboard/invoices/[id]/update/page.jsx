import { auth } from "@/auth";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { redirect, notFound } from "next/navigation";
import { getInvoiceById } from "@/app/mongodb/queries/invoice-queries";
import {
  fetchActiveCustomers,
  fetchAvailableProducts,
} from "@/app/mongodb/queries/invoice-queries";
import { getActiveCheckouts } from "@/app/mongodb/queries/checkout-queries";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";
import EditInvoiceFormClient from "../../components/EditInvoiceForm";
import { serializeBsonType } from "@/lib/utils";

export default async function EditInvoicePage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  if (!INVOICE_WRITE_ROLES.includes(user.role)) {
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
  const result = await getInvoiceById(resolvedParams.id);

  if (!result) {
    notFound();
  }

  const invoice = serializeBsonType(result);

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

  // Fetch customers, products, and active checkouts in parallel
  const [customers, products, checkouts, projects] = await Promise.all([
    fetchActiveCustomers(),
    fetchAvailableProducts(),
    getActiveCheckouts(),
    getActiveProjects(),
  ]);

  return (
    <EditInvoiceFormClient
      invoice={invoice}
      customers={customers}
      products={products}
      checkouts={checkouts}
      projects={projects}
      user={user}
    />
  );
}
