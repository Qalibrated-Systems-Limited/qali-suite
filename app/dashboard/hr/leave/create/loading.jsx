import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function LeaveCreateLoading() {
  return <FormPageSkeleton fields={4} withLineItems={false} />;
}
