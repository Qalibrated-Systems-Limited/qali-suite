import { UpdateInvoiceForm } from "./form";
import Breadcrumbs from "../../../../../components/ui/breadcrumbs";
import { notFound } from "next/navigation";
import Account from "../../../../models/account";
import Invoice from "../../../../models/invoice";

async function page(props) {
  const params = await props.params;
  const id = params.id;
  let invoice = await Invoice.findOne(
    { _id: id },
    {
      customer: 1,
      description: 1,
      taxRate: 1,
      status: 1,
      discount: 1,
      status: 1,
      dNoteNumber: 1,
    }
  );

  if (invoice) {
    invoice = {
      customer: { ...invoice.customer },
      _id: invoice._id.toString(),
      description: invoice.description,
      status: invoice.status,
      discount: invoice.discount,
      taxRate: invoice.taxRate,
      dNoteNumber: invoice.dNoteNumber,
    };
  }

  let customers = await Account.find({}, { name: 1 });
  if (customers) {
    customers = customers.map((customer) => {
      return { name: customer.name, _id: customer._id.toString() };
    });
  }

  if (!invoice || !customers) {
    return notFound();
  }
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Invoices", href: "/dashboard/invoices" },
          {
            label: "Edit invoice",
            href: `/dashboard/invoices/${id}/update`,
            active: true,
          },
        ]}
      />
      <UpdateInvoiceForm invoice={invoice} customers={customers} />
    </main>
  );
}

export default page;
