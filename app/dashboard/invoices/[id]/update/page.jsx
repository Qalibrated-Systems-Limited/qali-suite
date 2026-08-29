import { auth } from "@/auth";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { redirect, notFound } from "next/navigation";
import {
  getInvoiceDetailPg,
  getInvoiceFormData,
} from "@/app/db/actions/invoice-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import EditInvoiceFormClient from "../../components/EditInvoiceForm";

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

  // Read the invoice from the store the form writes to. This read Mongo with
  // what is now a Postgres uuid, so the edit page could not open at all.
  const invoice = await getInvoiceDetailPg(resolvedParams.id);

  // Null rather than forbidden for another tenant's invoice: RLS filters it
  // before the query sees it, so the page 404s (§2.2).
  if (!invoice) {
    notFound();
  }

  // Mirrors what updateInvoice refuses, and reads the right field to do it.
  // `status` is draft/completed/cancelled — "paid" is a PAYMENT status, so
  // `status === "paid"` was never true and a settled invoice could be opened
  // for editing here only to be refused on save.
  const blockedReason =
    invoice.paymentStatus === "paid"
      ? "Paid invoices cannot be edited."
      : invoice.status === "cancelled"
        ? "Cancelled invoices cannot be edited."
        : invoice.status === "completed"
          ? "Completed invoices cannot be edited. Raise a credit note instead."
          : null;

  if (blockedReason) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Cannot Edit Invoice
          </h2>
          <p className="text-muted-foreground mb-4">{blockedReason}</p>
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

  // See the create page: pickers come from Postgres, checkouts wait on the
  // fulfilment backfill, projects are still a Mongo module.
  const [{ customers, products }, projects] = await Promise.all([
    getInvoiceFormData(),
    getActiveProjects(),
  ]);
  const checkouts = [];

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
