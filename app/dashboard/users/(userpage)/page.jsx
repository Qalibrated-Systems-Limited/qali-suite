import Pagination from "../../../../components/ui/pagination";

import Search from "../../../../components/ui/search";
import UserTable from "../table";
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
import { fetchUserPages, searchUsers } from "../../../mongodb/queries";

async function page(props) {
  const searchParams = await props.searchParams;
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  if (user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <h1 className="font-semibold text-red-400">Not Authorized </h1>
      </div>
    );
  }

  const query = searchParams.query || "";

  const currentPage = Number(searchParams.page) || 1;
  const totalPages = await fetchUserPages(query);

  const accounts = await searchUsers(query, currentPage);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Users</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row items-center gap-8 md:mt-8">
            <Search placeholder="Search users..." />
            <Button>
              <Link href={"/dashboard/users/create"}>Create</Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <UserTable accounts={accounts} />
      </CardContent>

      <CardFooter>
        <Pagination totalPages={totalPages} />
      </CardFooter>
    </Card>
  );
}

export default page;
