import UpdateAccountForm from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";
import { notFound } from "next/navigation";
import User from "../../../../models/user";
import { auth } from "../../../../../auth";

async function page(props) {
  const params = await props.params;
  const id = params.id;

  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  if (user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <h1 className="font-semibold text-red-400">Not Authorized </h1>
      </div>
    );
  }
  let account = await User.findOne({ _id: id });
  account = {
    name: account.name,
    status: account.status,
    role: account.role,
    email: account.email,
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
          { label: "Users", href: "/dashboard/users" },
          {
            label: "Edit user",
            href: `/dashboard/users/${id}/update`,
            active: true,
          },
        ]}
      />
      <UpdateAccountForm account={account} />
    </main>
  );
}

export default page;
