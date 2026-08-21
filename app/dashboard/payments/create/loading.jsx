import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function PaymentsCreateLoading() {
  return <FormPageSkeleton fields={4} withLineItems={false} />;
}
