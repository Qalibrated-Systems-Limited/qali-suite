import Pagination from "../../../../components/ui/pagination";

import Search from "../../../../components/ui/search";
import InvoiceTable from "../table";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { FilterDialog } from "../../../../components/ui/custom_dialog";
import { DownloadReport } from "../download";

import { Button } from "../../../../components/ui/button";
import Link from "next/link";
import {
  fetchInvoicePages,
  filterInvoices,
  searchInvoice,
} from "../../../mongodb/queries";
import Account from "../../../models/account";
import { format } from "date-fns";

async function page(props) {
  const searchParams = await props.searchParams;

  const query = searchParams.query || "";

  const customer = searchParams.customer || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchInvoicePages(query);

  let customers = await Account.find({});
  if (customers) {
    customers = customers.map((customer) => {
      return { name: customer.name, _id: customer._id.toString() };
    });
  }

  let invoices = [];
  if (!startDate && !endDate) {
    invoices = await searchInvoice(query, currentPage);
  } else {
    invoices = await filterInvoices(customer, startDate, endDate);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Invoices</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-8 md:mt-8">
            <Search placeholder="Search invoices..." />

            <div className="flex flex-row gap-4 md:items-center">
              <FilterDialog customers={customers} />
              {startDate && (
                <DownloadReport
                  endDate={format(endDate, "dd-MM-yyyy")}
                  startDate={format(startDate, "dd-MM-yyyy")}
                  summaryResult={invoices}
                />
              )}
              <Link href={"/dashboard/invoices/create"}>
                <Button>Create</Button>
              </Link>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <InvoiceTable invoices={invoices} />
      </CardContent>

      <CardFooter>
        <Pagination totalPages={totalPages} />
      </CardFooter>
    </Card>
  );
}

export default page;
