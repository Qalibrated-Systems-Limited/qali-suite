import {
  searchStock,
  fetchStockPages,
  extractStock,
  fetchStockData,
} from "../../../mongodb/queries";

import Pagination from "../../../../components/ui/pagination";

import Search from "../../../../components/ui/search";
import StockTable from "../table";
import { auth } from "../../../../auth";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";

import { Button } from "../../../../components/ui/button";
import Link from "next/link";
import { DownloadStock } from "../downloadStock";
import { GenerateStockPDF } from "../export-to-pdf";

async function page(props) {
  const searchParams = await props.searchParams;
  const sesssion = await auth();

  const query = searchParams.query || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const commodity = searchParams.commodity || "";
  const customer = searchParams.customer || "";
  const vehicle = searchParams.vehicle || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchStockPages(query);

  const stock = await searchStock(query, currentPage);
  const stockData = await fetchStockData();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Stocks</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row items-center gap-8 md:mt-8">
            <Search placeholder="Search stock..." />

            <Link href={"/dashboard/stocks/create"}>
              <Button>Create</Button>
            </Link>
            <GenerateStockPDF stockData={stockData} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <StockTable stock={stock ?? []} />
      </CardContent>
      {!startDate && (
        <CardFooter>
          <Pagination totalPages={totalPages} />
        </CardFooter>
      )}
    </Card>
  );
}

export default page;
