import {
  searchTransactions,
  fetchTransactionPages,
  generateReport,
  getCommodity,
  getVehicles,
  getCustomers,
} from "../../../mongodb/queries";
import { CreateButton } from "../../../../components/ui/buttons";
import Pagination from "../../../../components/ui/pagination";

import Search from "../../../../components/ui/search";
import TransactionTable from "../table";
import { auth } from "../../../../auth";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { DownloadReport } from "../download";
import { FilterDialog } from "../../../../components/ui/custom_dialog";
import { Button } from "../../../../components/ui/button";
import Link from "next/link";
import { DeleteIcon } from "lucide-react";

async function page(props) {
  const searchParams = await props.searchParams;
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  const query = searchParams.query || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const commodity = searchParams.commodity || "";
  const customer = searchParams.customer || "";
  const vehicle = searchParams.vehicle || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchTransactionPages(query);

  let transactions = await searchTransactions(query, currentPage);

  const commodities = await getCommodity();

  const vehicles = await getVehicles();
  const customers = await getCustomers();
  if (startDate && endDate) {
    transactions = await generateReport(
      startDate,
      endDate,
      vehicle,
      commodity,
      customer
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Transactions</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row items-center gap-8 md:mt-8">
            {!startDate && <Search placeholder="Search transactions..." />}
            <div className="flex   items-center justify-end gap-4  w-full">
              <FilterDialog
                commodities={commodities ?? []}
                customers={customers ?? []}
                vehicles={vehicles ?? []}
              />

              {startDate && endDate && transactions && (
                <DownloadReport
                  endDate={endDate}
                  startDate={startDate}
                  summaryResult={transactions ?? []}
                />
              )}
              {startDate && endDate && transactions && (
                <Link href={"/dashboard/transactions"}>
                  <DeleteIcon size={30} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <TransactionTable transactions={transactions ?? []} />
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
