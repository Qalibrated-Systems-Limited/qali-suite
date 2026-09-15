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
  fetchMovementPagesPg,
  searchMovementsPg,
} from "@/app/db/actions/stock-movement-actions";

/**
 * POSTGRES since 0102.
 *
 * This route read `StockTransaction` through an Atlas `$search` index, in two
 * aggregations that took NO COMPANY FILTER — neither `fetchStockTxPages` nor
 * `searchStockTx` mentioned companyId, so the page counted and paged over
 * every tenant's stock transactions at once. It is not visible on the screen
 * because `table.jsx` is a stub that renders the word "table" and ignores the
 * rows it is handed, but the page count was everyone's.
 *
 * The actions below scope to the session's tenant through RLS and apply the
 * role rule the movements ledger already uses: a storekeeper sees the
 * movements they performed or received, not the company's whole history.
 *
 * The richer view of this data is /dashboard/movements, which supersedes this
 * page. This is kept working rather than removed because removing a route is
 * not a porting decision.
 */

async function page(props) {
  const searchParams = await props.searchParams;

  const query = searchParams.query || "";

  const currentPage = Number(searchParams.page) || 1;
  const [totalPages, txs] = await Promise.all([
    fetchMovementPagesPg({ search: query, page: currentPage }),
    searchMovementsPg({ search: query, page: currentPage }),
  ]);

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
