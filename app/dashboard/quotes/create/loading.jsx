import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function QuotesCreateLoading() {
  return <FormPageSkeleton fields={6} withLineItems={true} />;
}
