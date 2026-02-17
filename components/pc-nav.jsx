import { SidebarContentGrouped } from "./sidebar-content-grouped";

export function PcNav({ user }) {
  return (
    <aside className="hidden lg:flex w-64 bg-card border-r border-border flex-col h-screen sticky top-0 shrink-0">
      <SidebarContentGrouped user={user} />
    </aside>
  );
}
