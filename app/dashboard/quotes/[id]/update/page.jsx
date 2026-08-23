import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import {
  getQuoteForDisplayPg,
  getQuoteFormData,
} from "@/app/db/actions/quote-actions";
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

  const quote = await getQuoteForDisplayPg(id);

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

  // The SAME pickers the create form uses, reading the store this form writes
  // to. They were still the Mongo ones: the quote comes from Postgres, so
  // `quote.customer.partyId` and every `items[].product.id` are Postgres uuids,
  // and no Mongo `_id` could ever equal one. The customer combobox therefore
  // opened blank on a quote that has a customer, and each product line lost its
  // stock figure to the `|| 999` fallback. Choosing from those lists sent a
  // Mongo ObjectId as `customerId`/`productId` into a uuid column.
  //
  // They were also UNSCOPED for a SuperAdmin — see getQuoteFormData, whose
  // docblock already claims both forms. Only the create page was switched.
  const { customers, products } = await getQuoteFormData();

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
