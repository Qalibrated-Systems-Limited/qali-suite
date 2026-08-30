import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

/**
 * Honest placeholder for a section that has a real place in the Projects
 * module's navigation but no backing data model yet (Engineer's
 * Instructions, Site Diary, Monthly Report). Explains what the section is
 * for rather than showing an empty table or invented sample rows.
 */
export default function ComingSoonCard({ icon: Icon, title, description, bullets = [] }) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="rounded-lg p-3 bg-primary/10 shrink-0">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-lg">{title}</h2>
            <Badge variant="outline" className="text-xs">
              Coming soon
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
          {bullets.length > 0 && (
            <ul className="text-sm text-muted-foreground space-y-1.5 pt-1">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" disabled className="mt-2">
            <Plus className="h-4 w-4 mr-1.5" />
            New entry
          </Button>
        </div>
      </div>
    </Card>
  );
}
