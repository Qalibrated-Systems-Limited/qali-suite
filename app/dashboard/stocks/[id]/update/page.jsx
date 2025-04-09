import UpdateStockForm from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";
import { notFound } from "next/navigation";
import Product from "../../../../models/product";
import { auth } from "../../../../../auth";

async function page(props) {
  const params = await props.params;
  const id = params.id;

  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  if (user.role !== "Store Manager") {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <h1 className="font-semibold text-red-400">Not Authorized </h1>
      </div>
    );
  }
  let stock = await Product.findOne({ _id: id });

  if (stock) {
    stock = {
      name: stock.name,
      SKU: stock.SKU,
      description: stock.description,
      category: stock.category,
      price: stock.price,
      stock: stock.stock,
      unit: stock.unit,
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
