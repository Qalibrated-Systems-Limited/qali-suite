import { auth } from "../../auth";

import MainMenu from "./components/main-menu";
import MobileNav from "./components/mombile-nav";

export const metadata = {
  title: "Kilosahihi dashboard",
  description: "Manage your weighbridge",
};

async function layout({ children }) {
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
    <div className="md:grid grid-cols-[250px_1fr] h-screen  ">
      <MainMenu className="hidden md:flex" name={user.name ?? ""} />
      <MobileNav name={user.name ?? ""} />

      <div className="overflow-auto py-2 px-4">
        <h1 className="pb-4  ">Welcome back , {name} !</h1>
        {children}
      </div>
    </div>
  );
}

export default layout;
