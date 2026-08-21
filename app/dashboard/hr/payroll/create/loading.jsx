import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function PayrollCreateLoading() {
  return <FormPageSkeleton fields={6} withLineItems={true} />;
}
