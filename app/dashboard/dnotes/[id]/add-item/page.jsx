import AddItemForm from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";

import Product from "../../../../models/product";
import dbConnect from "../../../../config/dbConnect";

async function page(props) {
  const params = await props.params;
  const id = params.id;
  dbConnect();

  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Delivery Notes", href: `/dashboard/dnotes/${id}` },
          {
            label: "Add Item",
            href: `/dashboard/dnotes/${id}/add-item`,
            active: true,
          },
        ]}
      />
      <AddItemForm id={id} />
    </main>
  );
}

export default page;
