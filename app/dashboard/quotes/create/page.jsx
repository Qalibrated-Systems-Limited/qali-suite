import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  fetchActiveCustomers,
  fetchAvailableProducts,
} from "@/app/mongodb/queries/invoice-queries";
import { getQuoteById } from "@/app/mongodb/queries/quote-queries";
import CreateQuoteForm from "../components/CreateQuoteForm";

export default async function CreateQuotePage({ searchParams }) {
  const session = await auth();
  const params = await searchParams;

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Viewers cannot create quotes
  if (user.role === "Viewer") {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            Viewers cannot create quotes.
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

  // Check if duplicating from existing quote
  let duplicateFrom = null;
  if (params.from) {
    duplicateFrom = await getQuoteById(params.from);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">
          {duplicateFrom ? "Duplicate Quote" : "Create Quote"}
        </h1>
        <p className="text-muted-foreground">
          {duplicateFrom
            ? `Creating new quote based on ${duplicateFrom.quoteNumber}`
            : "Create a new quotation for a customer"}
        </p>
      </div>

      {/* Form */}
      <CreateQuoteForm
        customers={customers}
        products={products}
        duplicateFrom={duplicateFrom}
      />
    </div>
  );
}
