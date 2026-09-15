import { auth } from "@/auth";
import { redirect } from "next/navigation";
import BidsBoard from "./BidsBoard";
import { getBidsData } from "@/app/db/actions/bids-actions";
import { hasRole, BID_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Bids & Pre-Sales | QaliSuite",
  description: "Tenders, compliance & pipeline — track bids from draft to award.",
};

export const dynamic = "force-dynamic";

export default async function BidsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getBidsData();
  const canManage = hasRole(session.user, BID_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <BidsBoard bids={data.bids} stats={data.stats} users={data.users} canManage={canManage} />
    </div>
  );
}
