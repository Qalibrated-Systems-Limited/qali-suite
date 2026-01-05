import { SidebarContent } from "./sidebar-content";

export function PcNav({ user }) {
  return (
    <aside className="hidden lg:flex w-64 bg-[#161b22] border-r border-[#30363d] flex-col">
      <SidebarContent user={user} />
    </aside>
  );
}
