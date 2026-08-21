import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function ExpensesCreateLoading() {
  return <FormPageSkeleton fields={4} withLineItems={false} />;
}
