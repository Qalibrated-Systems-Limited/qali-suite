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

import { Button } from "../../../../components/ui/button";
import Link from "next/link";
import { fetchDnotePages, searchDnotes } from "../../../mongodb/queries";

import DNoteTable from "../table";

async function page(props) {
  const searchParams = await props.searchParams;

  const query = searchParams.query || "";

  const customer = searchParams.customer || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchDnotePages(query);

  const deliveryNotes = await searchDnotes();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Delivery Notes</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-8 md:mt-8">
            <Search placeholder="Search delivery notes..." />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <DNoteTable invoices={deliveryNotes} />
      </CardContent>

      <CardFooter>
        <Pagination totalPages={totalPages} />
      </CardFooter>
    </Card>
  );
}

export default page;
