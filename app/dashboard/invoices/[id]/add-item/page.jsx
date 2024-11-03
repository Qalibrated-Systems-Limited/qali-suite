import AddItemForm from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";

import Product from "../../../../models/product";

async function page(props) {
  const params = await props.params;
  const id = params.id;
  const stocks = await Product.find(
    {},
    { name: 1, SKU: 1, quantity: 1, _id: 0 }
  ).lean();
  console.log(stocks);
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
