import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Hammer } from "lucide-react";

/**
 * A Project Control screen that is in the workspace nav but not yet built out.
 * Names the screen and what it is for (from the template), so the workspace is
 * complete to navigate while the screens are filled in one by one.
 */
export default function PCScreenStub({ title, blurb, related }) {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Card className="p-6 sm:p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Hammer className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {blurb && (
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
            {blurb}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          This Project Control screen is being built. It is in the workspace so
          the navigation matches the template; the screen itself lands in a
          following update.
        </p>
        {related?.href && (
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link href={related.href}>{related.label}</Link>
          </Button>
        )}
      </Card>
    </div>
  );
}
