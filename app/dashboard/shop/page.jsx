import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ShopBoard from "./ShopBoard";
import { getShopData } from "@/app/db/actions/shop-actions";
import { hasRole, SHOP_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Online Shop | QaliSuite",
  description: "Storefront orders & catalog — listed straight from your inventory.",
};

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getShopData();
  const canManage = hasRole(session.user, SHOP_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <ShopBoard orders={data.orders} catalog={data.catalog} stats={data.stats} canManage={canManage} />
    </div>
  );
}
