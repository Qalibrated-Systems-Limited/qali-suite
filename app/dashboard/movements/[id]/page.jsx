import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getMovementByIdPg as getMovementById } from "@/app/db/actions/stock-movement-actions";
import { MovementDetail } from "./MovementDetail";

export const metadata = { title: "Movement Details" };

export default async function MovementDetailPage(props) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const movement = await getMovementById(params.id);
  if (!movement) return notFound();

  return <MovementDetail movement={movement} />;
}
