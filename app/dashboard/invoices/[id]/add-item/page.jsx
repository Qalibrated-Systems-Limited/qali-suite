import AddItemForm from "./form";
import Breadcrumbs from "../../../../../components/breadcrumbs";

import Product from "../../../../models/product";
import dbConnect from "../../../../config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";

async function page(props) {
  const params = await props.params;
  const id = params.id;
  await dbConnect();
  const { companyId } = await getTenantContext();
  const stocks = await Product.find(
    { companyId },
    { name: 1, SKU: 1, quantity: 1, _id: 0 }
  ).lean();
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Invoice", href: `/dashboard/invoices/${id}` },
          {
            label: "Add Item",
            href: `/dashboard/invoices/${id}/add-item`,
            active: true,
          },
        ]}
      />
      <AddItemForm products={stocks} id={id} />
    </main>
  );
}

export default page;
