import { auth } from "@/auth";
import { redirect } from "next/navigation";
import FleetBoard from "./FleetBoard";
import { getFleetData } from "@/app/db/actions/fleet-actions";

export const metadata = {
  title: "Fleet | QaliSuite",
  description: "Vehicles, trips, fuel & maintenance — with insurance and service alerts.",
};

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getFleetData();

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <FleetBoard
        vehicles={data.vehicles}
        trips={data.trips}
        maintenance={data.maintenance}
        stats={data.stats}
        users={data.users}
        expenseAccounts={data.expenseAccounts}
        assets={data.assets}
        canManage={data.canManage}
      />
    </div>
  );
}
