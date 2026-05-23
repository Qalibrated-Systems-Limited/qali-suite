import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getRequestById } from "@/app/mongodb/queries/request-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { serializeBsonType } from "@/lib/utils";
import { RequestDetail } from "./RequestDetail";

export const metadata = { title: "Stock Request Details" };

export default async function RequestDetailPage(props) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const request = await getRequestById(params.id);
  if (!request) return notFound();

  // Visibility gate — only the requester or roles that can see all
  // requests get past this. Otherwise redirect back to the list (which
  // already enforces the same role-based filter at the query layer).
  const userRole = session.user.role;
  const isOwn = request.requester?.id === session.user.id;
  const FULL_VISIBILITY = ["SuperAdmin", "Admin", "Manager", "Store Manager"];
  const PARTIAL_VISIBILITY_STATUSES = [
    "approved",
    "fulfilled",
    "partially_fulfilled",
  ];
  const storekeeperCanSee =
    userRole === "Storekeeper" &&
    PARTIAL_VISIBILITY_STATUSES.includes(request.status);

  if (!isOwn && !FULL_VISIBILITY.includes(userRole) && !storekeeperCanSee) {
    redirect("/dashboard/requests");
  }

  let company = null;
  if (session.user.companyId) {
    const fetched = await getCompanyById(session.user.companyId);
    if (fetched) company = serializeBsonType(fetched);
  }

  return (
    <RequestDetail
      request={request}
      userRole={userRole}
      userId={session.user.id}
      company={company}
    />
  );
}
