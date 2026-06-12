"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck, CheckSquare, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/mongodb/actions/notification-actions";

// In-app notification bell. Server-rendered data arrives via props (the
// dashboard layout fetches cMyNotifications once per request); marking
// read goes through server actions + router.refresh. Visible on ALL
// breakpoints — the panel is sized for thumbs on mobile (w-[min(92vw,...)],
// roomy tap targets) and a fixed 24rem on desktop.

const TYPE_ICONS = {
  approval_request: CheckSquare,
  approval_decision: CheckCheck,
  system: Sparkles,
};

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

export default function NotificationBell({ items = [], unread = 0 }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onMarkAll = () =>
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });

  const onItemClick = (n) => {
    setOpen(false);
    if (!n.read) {
      startTransition(async () => {
        await markNotificationRead(n._id);
        router.refresh();
      });
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground hover:bg-accent h-8 w-8"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
          <span className="sr-only">
            Notifications{unread > 0 ? ` (${unread} unread)` : ""}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[min(92vw,24rem)] bg-card border-border p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              onClick={onMarkAll}
              disabled={isPending}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            items.map((n) => {
              const Icon = TYPE_ICONS[n.type] || Sparkles;
              const inner = (
                <div className="flex gap-2.5">
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      n.read ? "bg-muted" : "bg-primary/15"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 ${n.read ? "text-muted-foreground" : "text-primary"}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm leading-snug ${n.read ? "text-muted-foreground" : "font-medium"}`}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </div>
              );
              // Generous tap target (py-2.5) for mobile thumbs.
              return n.href ? (
                <Link
                  key={n._id}
                  href={n.href}
                  onClick={() => onItemClick(n)}
                  className="block border-b border-border/50 px-3 py-2.5 last:border-0 hover:bg-accent/50"
                >
                  {inner}
                </Link>
              ) : (
                <button
                  key={n._id}
                  onClick={() => onItemClick(n)}
                  className="block w-full border-b border-border/50 px-3 py-2.5 text-left last:border-0 hover:bg-accent/50"
                >
                  {inner}
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
