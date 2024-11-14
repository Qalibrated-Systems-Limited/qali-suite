import InvoiceDetails from "../../components/invoice-details";
import { Suspense } from "react";
import { InvoiceDetailsSkeleton } from "../../components/invoice-detail-skeleton";

async function page(props) {
  const params = await props.params;
  const id = params.id;

  return (
    <Suspense fallback={<InvoiceDetailsSkeleton />}>
      <InvoiceDetails id={id} />;
    </Suspense>
  );
}

export default page;
