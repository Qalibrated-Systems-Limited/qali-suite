import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function RequestsCreateLoading() {
  return <FormPageSkeleton fields={6} withLineItems={true} />;
}
