import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function EmployeesCreateLoading() {
  return <FormPageSkeleton fields={4} withLineItems={false} />;
}
