import {
  StickyNote,
  Phone,
  Mail,
  Users,
  MessageCircle,
  ArrowRightLeft,
  Sparkles,
} from "lucide-react";

// Server component — renders the relationship timeline for one entity.
// Pure presentation; the data comes from cTimeline().

const ICONS = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: Users,
  whatsapp: MessageCircle,
  sms: MessageCircle,
  stage_change: ArrowRightLeft,
  conversion: Sparkles,
  system: Sparkles,
};

function timeAgo(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ActivityTimeline({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        No activity yet. Log the first interaction below.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {activities.map((a) => {
        const Icon = ICONS[a.type] || StickyNote;
        return (
          <li key={a._id} className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {a.subject || a.type}
                  {a.direction && a.direction !== "none" && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      ({a.direction})
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(a.occurredAt)}
                </span>
              </div>
              {a.body && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                  {a.body}
                </p>
              )}
              {a.by?.name && (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  {a.by.name}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
