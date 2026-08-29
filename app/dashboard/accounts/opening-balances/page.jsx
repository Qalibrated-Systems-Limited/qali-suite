import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { auth } from "@/auth";
import { getOpeningBalanceSetupPg } from "@/app/db/actions/opening-balance-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OpeningBalancesClient } from "./OpeningBalancesClient";

export const metadata = {
  title: "Opening Balances | Accounts",
  description: "Enter your account balances as of your start date",
};

const ALLOWED_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
];

export default async function OpeningBalancesPage() {
  const session = await auth();
  const user = session?.user;

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <Shield className="h-10 w-10 mx-auto text-red-500" />
            <h2 className="text-lg font-bold">Access denied</h2>
            <p className="text-sm text-muted-foreground">
              Only finance roles can book opening balances.
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard/accounts">Back to Accounts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const setup = await getOpeningBalanceSetupPg();

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/dashboard/accounts">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Opening Balances</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Enter what your business owned, owed, and was worth on your start
            date, so the books carry on from your real figures. Anything left
            over to balance is parked in <strong>Opening Balance Equity</strong>{" "}
            for your accountant to reclassify.
          </p>
        </div>
      </div>

      <OpeningBalancesClient setup={setup} />
    </div>
  );
}
