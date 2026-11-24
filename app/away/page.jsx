import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { judgeCurrentRequest } from "@/app/db/networkAccess";
import AwayScene from "./AwayScene";

export const metadata = {
  title: "You're away from the office | QaliSuite",
  description: "QaliSuite is kept to the office network. Enter your remote-access token to continue.",
};
export const dynamic = "force-dynamic";

/**
 * Where someone lands when their company keeps QaliSuite to the office
 * network and they are somewhere else. If they are in fact allowed (back on
 * the office Wi-Fi, or their token is already on this device), straight on to
 * the dashboard.
 */
export default async function AwayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const companyId = String(user.activeCompanyId ?? user.companyId ?? "");
  if (companyId) {
    const verdict = await judgeCurrentRequest(String(user.id), companyId).catch(() => ({ allowed: false }));
    if (verdict.allowed) redirect("/dashboard");
  }
  const firstName = String(user.name || "").split(" ")[0] || "there";
  return <AwayScene firstName={firstName} />;
}
