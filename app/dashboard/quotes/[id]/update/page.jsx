import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { getQuoteById } from "@/app/mongodb/queries/quote-queries";
import {
  fetchActiveCustomers,
  fetchAvailableProducts,
} from "@/app/mongodb/queries/invoice-queries";
import { ArrowLeft } from "lucide-react";
import UpdateQuoteForm from "../../components/UpdateQuoteForm";

export default async function UpdateQuotePage({ params }) {
  const session = await auth();
  const { id } = await params;

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Canonical sales-document write set (same as invoices). The previous
  // inline list named a non-existent "Sales" role and excluded Sales
  // Manager / CFO / Finance Manager. CEO is intentionally absent — read
  // across the business, no operational writes.
  if (!INVOICE_WRITE_ROLES.includes(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to edit quotes.
          </p>
        </div>
      </div>
    );
  }

  const quote = await getQuoteById(id);

  if (!quote) {
    notFound();
  }

  // Check if quote can be edited
  if (quote.status !== "draft") {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Cannot Edit</h2>
          <p className="text-muted-foreground mb-4">
            Only draft quotes can be edited. This quote is "{quote.status}".
          </p>
          <Link
            href={`/dashboard/quotes/${id}`}
            className="text-yellow-500 hover:underline"
          >
            Return to Quote
          </Link>
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
      <div className="space-y-2">
        <Link
          href={`/dashboard/quotes/${id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Quote
        </Link>
        <h1 className="text-3xl font-bold text-foreground">
          Edit Quote {quote.quoteNumber}
        </h1>
        <p className="text-muted-foreground">
          Update quote details and items
        </p>
      </div>

      {/* Form */}
      <UpdateQuoteForm
        quote={quote}
        customers={customers}
        products={products}
      />
    </div>
  );
}
