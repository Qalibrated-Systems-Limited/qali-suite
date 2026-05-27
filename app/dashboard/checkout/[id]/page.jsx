import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getCheckoutById } from "@/app/mongodb/queries/checkout-queries";
import { CheckoutDetail } from "./CheckoutDetail";

export const metadata = { title: "Checkout Details" };

export default async function CheckoutDetailPage(props) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const checkout = await getCheckoutById(params.id);
  if (!checkout) return notFound();

  // Visibility gate — non-managers can only see their own checkouts.
  const role = session.user.role;
  const isOwn = checkout.checkedOutTo?.id?.toString() === session.user.id;
  const canManage = ["SuperAdmin", "Admin", "Store Manager", "Manager"].includes(role);

  if (!isOwn && !canManage) {
    redirect("/dashboard/checkout");
  }

  return <CheckoutDetail checkout={checkout} canManage={canManage} />;
}
