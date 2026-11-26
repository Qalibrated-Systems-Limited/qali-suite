import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { ArrowLeft, Mail } from "lucide-react";
import { getNotificationSetup } from "@/app/db/actions/notification-setup-actions";
import NotificationSetupBoard from "./NotificationSetupBoard";

export const metadata = { title: "Email & notifications | Settings" };
export const dynamic = "force-dynamic";

export default async function NotificationSetupPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "admin.manage")) redirect("/dashboard");
  const setup = await getNotificationSetup();
  return (
    <div className="max-w-4xl space-y-6 sm:p-2 lg:p-4">
      <div className="flex items-start gap-3">
        <Link href="/dashboard/settings" className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <Mail className="h-6 w-6 text-primary" /> Email &amp; notifications
          </h1>
          <p className="text-sm text-muted-foreground">
            Check that invitations and alerts can leave the system, and send yourself a test.
          </p>
        </div>
      </div>
      <NotificationSetupBoard setup={setup} />
    </div>
  );
}
