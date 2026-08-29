import { auth } from "@/auth";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { redirect } from "next/navigation";
import { getInvoiceFormData } from "@/app/db/actions/invoice-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import CreateInvoiceFormClient from "../components/CreateInvoiceForm";

export default async function CreateInvoicePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  if (!INVOICE_WRITE_ROLES.includes(user.role)) {
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

  // Customers and products come from Postgres — the store the form writes to.
  // They were served from Mongo, so every id the picker offered named a
  // record that did not exist where the invoice was being written.
  //
  // Checkouts are empty until item_checkouts is backfilled: the column is a
  // real FK, and a picker whose every option fails the write is worse than no
  // picker. Projects are still a Mongo module.
  const [{ customers, products }, projects] = await Promise.all([
    getInvoiceFormData(),
    getActiveProjects(),
  ]);
  const checkouts = [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Create Invoice</h1>
        <p className="text-muted-foreground">
          Generate a new invoice for direct sales
        </p>
      </div>

      {/* Form */}
      <CreateInvoiceFormClient
        customers={customers}
        products={products}
        checkouts={checkouts}
        projects={projects}
      />
    </div>
  );
}
