import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HRNav from "./components/HRNav";

export default async function HRLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role || "Employee";

  return (
    <div className="flex min-h-screen flex-col">
      <HRNav role={role} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
