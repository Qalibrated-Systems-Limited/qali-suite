import {
  WeightIcon,
  CheckIcon,
  TruckIcon,
  ListChecksIcon,
  PersonStandingIcon,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { fetchCardsData } from "../../mongodb/queries";

export async function Cardwrapper({}) {
  const { numberOfAccounts, numberOfTrans, numberOfVehicles } =
    await fetchCardsData();
  return (
    <div className=" grid  lg:grid-cols-3 gap-4 ">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Transactions</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-between items-center">
          <div className="flex gap-2">
            <WeightIcon />
            <span className="text-2xl font-bold">{numberOfTrans}</span>
          </div>
        </CardContent>
        <CardFooter>
          <span className="text-xs flex gap-1 items-center">
            <CheckIcon />
            All weight records since installation
          </span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <ListChecksIcon />
            <span className="text-2xl font-bold">{numberOfAccounts}</span>
          </div>
        </CardContent>
        <CardFooter>
          <span className="text-xs flex gap-1 items-center">
            <PersonStandingIcon />
            All accounts
          </span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Vehicles</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-between items-center">
          <div className="flex gap-2 items-center">
            <TruckIcon />
            <span className="text-2xl font-bold">{numberOfVehicles}</span>
          </div>

          <div>
            <Button asChild size={"xs"}>
              <Link href={"/dashboard/tags"}>View All </Link>
            </Button>
          </div>
        </CardContent>
        <CardFooter>
          <span className="text-xs flex gap-1 items-center">
            <CheckIcon />
            Vehicles registered
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
