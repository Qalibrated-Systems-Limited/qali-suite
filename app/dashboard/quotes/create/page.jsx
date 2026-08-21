import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  getQuoteFormData,
  getQuoteForDisplayPg,
} from "@/app/db/actions/quote-actions";
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

  // Scoped to the company this request is acting in — for a SuperAdmin, the
  // one chosen in the switcher. The Mongo pickers read through withTenantScope,
  // which is UNSCOPED for a SuperAdmin, so this combobox listed every tenant's
  // customers.
  const { customers, products } = await getQuoteFormData();

  // Check if duplicating from existing quote
  let duplicateFrom = null;
  if (params.from) {
    // The PAGE shape, not the schema shape. CreateQuoteForm's duplicate
    // initialisers read `items[].product.sku` and `termsAndConditions`;
    // getQuoteDetail returns `lines[]` and `terms`, so duplicating a quote
    // silently produced an empty form with no lines and no terms.
    duplicateFrom = await getQuoteForDisplayPg(params.from);
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
