import { CreateAccountForm } from "./form";
import Breadcrumbs from "../../../../components/ui/breadcrumbs";

function page() {
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Accounts", href: "/dashboard/customers" },
          {
            label: "Create Customers",
            href: "/dashboard/customers/create",
            active: true,
          },
        ]}
      />
      <CreateAccountForm />
    </main>
  );
}

export default page;
