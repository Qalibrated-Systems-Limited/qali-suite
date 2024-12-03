import { CreateDNoteForm } from "./form";
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
          { label: "Delivery Notes", href: "/dashboard/dnotes" },
          {
            label: "Create Delivery Note",
            href: "/dashboard/dnotes/create",
            active: true,
          },
        ]}
      />
      <CreateDNoteForm customers={accounts} />
    </main>
  );
}

export default page;
