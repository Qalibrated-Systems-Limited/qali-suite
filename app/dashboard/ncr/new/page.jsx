import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { auth } from "@/auth";
import { roleAllowed } from "@/lib/permissions";
import { NCR_RAISE_ROLES } from "@/lib/utils/role-gates";
import { getNcrRaiseOptionsPg } from "@/app/db/actions/ncr-actions";
import RaiseNCRForm from "../components/RaiseNCRForm";

export const metadata = { title: "Raise NCR" };
export const dynamic = "force-dynamic";

export default async function RaiseNCRPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, [...NCR_RAISE_ROLES])) redirect("/dashboard/ncr");
  const sp = await searchParams;
  const options = await getNcrRaiseOptionsPg();
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/dashboard/ncr" className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <ShieldAlert className="h-6 w-6 text-amber-500" /> Raise a nonconformance
          </h1>
          <p className="text-sm text-muted-foreground">
            Say what is wrong and why. A discrepancy with a supplier is forwarded to them as soon as it is raised.
          </p>
        </div>
      </div>
      <RaiseNCRForm options={options} initialReceiptId={sp?.grn || ""} />
    </div>
  );
}
