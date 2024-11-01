import UpdateStockForm from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";
import { notFound } from "next/navigation";
import Product from "../../../../models/product";

async function page(props) {
  const params = await props.params;
  const id = params.id;
  let stock = await Product.findOne({ _id: id });

  if (stock) {
    stock = {
      name: stock.name,
      SKU: stock.SKU,
      description: stock.description,
      category: stock.category,
      price: stock.price,
      stock: stock.stock,
      _id: stock._id.toString(),
    };
  }

  if (!stock) {
    return notFound();
  }
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Stocks", href: "/dashboard/stocks" },
          {
            label: "Edit stock",
            href: `/dashboard/stocks/${id}/update`,
            active: true,
          },
        ]}
      />
      <UpdateStockForm stock={stock} />
    </main>
  );
}

export default page;
