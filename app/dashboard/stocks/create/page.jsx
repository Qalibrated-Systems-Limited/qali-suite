import { CreateStockForm } from "./form";
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
          { label: "Stocks", href: "/dashboard/stocks" },
          {
            label: "Add stock",
            href: "/dashboard/stocks/create",
            active: true,
          },
        ]}
      />
      <CreateStockForm />
    </main>
  );
}

export default page;
