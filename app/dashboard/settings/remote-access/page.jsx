import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { ArrowLeft, Wifi } from "lucide-react";
import { getRemoteAccessSettings } from "@/app/db/actions/remote-access-actions";
import RemoteAccessBoard from "./RemoteAccessBoard";

export const metadata = { title: "Remote access | Settings" };
export const dynamic = "force-dynamic";

export default async function RemoteAccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "admin.manage")) redirect("/dashboard");
  const data = await getRemoteAccessSettings();
  return (
    <div className="max-w-5xl space-y-6 sm:p-2 lg:p-4">
      <div className="flex items-start gap-3">
        <Link href="/dashboard/settings" className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <Wifi className="h-6 w-6 text-primary" /> Remote access
          </h1>
          <p className="text-sm text-muted-foreground">
            Keep QaliSuite to the office network. People working away get a personal token from you; everyone else
            away from the office sees a waiting page.
          </p>
        </div>
      </div>
      <RemoteAccessBoard data={data} />
    </div>
  );
}
