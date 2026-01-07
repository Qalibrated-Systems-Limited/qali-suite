import { SidebarContentGrouped } from "./sidebar-content-grouped";

export function PcNav({ user }) {
  return (
    <aside className="hidden lg:flex w-64 bg-card border-r border-border flex-col">
      <SidebarContentGrouped user={user} />
    </aside>
  );
}
