import { CreateInvoiceForm } from "./form";
import Breadcrumbs from "../../../../components/ui/breadcrumbs";
import Account from "../../../models/account";

async function page() {
  let accounts = await Account.find({}).lean();

  if (accounts) {
    accounts = accounts.map((account) => {
      return { name: account.name, _id: account._id.toString() };
    });
  }

  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Invoices", href: "/dashboard/invoices" },
          {
            label: "Create invoice",
            href: "/dashboard/invoices/create",
            active: true,
          },
        ]}
      />
      <CreateInvoiceForm customers={accounts} />
    </main>
  );
}

export default page;
