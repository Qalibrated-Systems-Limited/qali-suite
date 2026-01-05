import Pagination from "../../../../components/pagination";

import Search from "../../../../components/search";
import StockTxTable from "../table";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";

import { Button } from "../../../../components/ui/button";
import Link from "next/link";
import {
  fetchStockTxPages,
  searchStockTx,
} from "../../../mongodb/queries/queries";

async function page(props) {
  const searchParams = await props.searchParams;

  const query = searchParams.query || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchStockTxPages(query);

  const txs = await searchStockTx(query, currentPage);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Stock Transactions</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row items-center gap-8 md:mt-8">
            <Search placeholder="Search stock transactions..." />
            {/* <Button>
              <Link href={"/dashboard/transactions/create"}>Create</Link>
            </Button> */}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <StockTxTable txs={txs ?? []} />
      </CardContent>

      <CardFooter>
        <Pagination totalPages={totalPages} />
      </CardFooter>
    </Card>
  );
}

export default page;
