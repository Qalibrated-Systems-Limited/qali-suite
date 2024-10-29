import Pagination from "../../../../components/ui/pagination";

import Search from "../../../../components/ui/search";
import AccounTable from "../table";
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
import { fetchAccountsPages, searchAccounts } from "../../../mongodb/queries";

async function page(props) {
  const searchParams = await props.searchParams;
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  const query = searchParams.query || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchAccountsPages(query);

  const accounts = await searchAccounts(query, currentPage);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Accounts</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row items-center gap-8 md:mt-8">
            <Search placeholder="Search accounts..." />
            <Button>
              <Link href={"/dashboard/customers/create"}>Create</Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <AccounTable accounts={accounts} />
      </CardContent>

      <CardFooter>
        <Pagination totalPages={totalPages} />
      </CardFooter>
    </Card>
  );
}

export default page;
