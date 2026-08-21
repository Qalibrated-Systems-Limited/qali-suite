import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function StocksCreateLoading() {
  return <FormPageSkeleton fields={4} withLineItems={false} />;
}
