import UpdateAccountForm from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";
import { notFound } from "next/navigation";
import Account from "../../../../models/account";

async function page(props) {
  const params = await props.params;
  const id = params.id;
  let account = await Account.findOne({ _id: id });
  account = {
    name: account.name,
    status: account.status,
    accountType: account.accountType,
    _id: account._id.toString(),
  };
  console.log(account);

  if (!account) {
    return notFound();
  }
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Accounts", href: "/dashboard/customers" },
          {
            label: "Edit account",
            href: `/dashboard/customers/${id}/update`,
            active: true,
          },
        ]}
      />
      <UpdateAccountForm account={account} />
    </main>
  );
}

export default page;
