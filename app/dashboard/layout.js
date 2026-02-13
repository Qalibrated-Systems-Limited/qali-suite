import { auth } from "../../auth";
// import { AppSidebar } from "./components/app-sidebar";
// import { SiteHeader } from "@/components/site-header";

import { AppSidebar } from "./components/app-sidebar";

export const metadata = {
  title: "QaliSuite Dashboard",
  description: "Enterprise Resource Planning",
};

async function DashboardLayout({ children }) {
  const session = await auth();
  const user = session?.user;

  let name = "";
  if (user) {
    name = user.name ?? "";
    if (name.trim().includes(" ")) {
      name = name.split(" ")[0];
    }
  }

  return (
    <>
      <AppSidebar
        user={user}
        children={<div className=" p-4 md:p-6 lg:p-8">{children}</div>}
      />
    </>
  );
}

export default DashboardLayout;
