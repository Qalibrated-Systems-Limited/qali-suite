import { UpdateDNoteForm } from "./form";
import Breadcrumbs from "../../../../../components/breadcrumbs";
import Account from "../../../../models/account";
import DeliveryNote from "../../../../models/dnote";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";

async function page(props) {
  const params = await props.params;
  const id = params.id;

  await dbConnect();
  const { companyId } = await getTenantContext();

  let deliveryNote = await DeliveryNote.findOne(
    { _id: id, companyId },
    {
      customer: 1,
      notes: 1,
    }
  );

  if (deliveryNote) {
    deliveryNote = {
      customer: { ...deliveryNote.customer },
      notes: deliveryNote.notes,
      _id: deliveryNote._id.toString(),
    };
  }
  let accounts = await Account.find({ companyId }).lean();

  if (accounts) {
    accounts = accounts.map((account) => {
      return { name: account.name, _id: account._id.toString() };
    });
  }

  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: "Delivery Notes", href: "/dashboard/dnotes" },
          {
            label: "Update Delivery Note",
            href: "/dashboard/dnotes/create",
            active: true,
          },
        ]}
      />
      <UpdateDNoteForm customers={accounts} dNote={deliveryNote} />
    </main>
  );
}

export default page;
