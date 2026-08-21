import { FormPageSkeleton } from "@/components/form-page-skeleton";

export default function CompaniesCreateLoading() {
  return <FormPageSkeleton fields={4} withLineItems={false} />;
}
