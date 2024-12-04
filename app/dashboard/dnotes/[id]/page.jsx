import { Suspense } from "react";
import { InvoiceDetailsSkeleton } from "../../components/invoice-detail-skeleton";
import DeliveryNoteDetail from "../../components/dnote-details";

async function page(props) {
  const params = await props.params;
  const id = params.id;

  return (
    <Suspense fallback={<InvoiceDetailsSkeleton />}>
      <DeliveryNoteDetail id={id} />;
    </Suspense>
  );
}

export default page;
