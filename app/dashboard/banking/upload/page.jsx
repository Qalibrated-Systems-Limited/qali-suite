import { getBankAccounts } from "@/app/mongodb/queries/bank-feed-queries";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import UploadWizard from "./UploadWizard";

export const metadata = {
  title: "Import Bank Statement | Banking",
  description: "Import and map bank statement CSV file",
};

export default async function UploadPage() {
  const session = await auth();

  // Only Admin and Accountant can import
  if (!["SuperAdmin", "Admin", "Accountant"].includes(session?.user?.role)) {
    redirect("/dashboard/banking");
  }

  const bankAccounts = await getBankAccounts();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <UploadWizard bankAccounts={bankAccounts} />
    </div>
  );
}
