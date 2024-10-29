import { CreateUserForm } from "./form";
import Breadcrumbs from "../../../../components/ui/breadcrumbs";
import { auth } from "../../../../auth";

async function page() {
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  if (user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <h1 className="font-semibold text-red-400">Not Authorized </h1>
      </div>
    );
  }
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Users", href: "/dashboard/users" },
          {
            label: "Create User",
            href: "/dashboard/users/create",
            active: true,
          },
        ]}
      />
      <CreateUserForm />
    </main>
  );
}

export default page;
