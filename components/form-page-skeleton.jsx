import { Skeleton } from "@/components/ui/skeleton";

/**
 * The instant fallback for a create or edit page.
 *
 * All thirty create/edit routes reached the browser with no `loading` file, and
 * most of them await their pickers — suppliers, products, the chart of accounts
 * — at the top level of the page component. With no fallback the router has
 * nothing to paint, so clicking "New …" left the user on the old page until the
 * entire server render finished. That is the delay people feel on click.
 *
 * Deliberately generic. A skeleton that mirrors one particular form is a second
 * copy of that form's layout, and it goes stale the first time somebody adds a
 * field. What has to arrive instantly is the page's SHAPE — a heading, a card,
 * fields, actions — so the navigation reads as immediate and the real form
 * replaces it in place.
 *
 * Uses the theme-aware `Skeleton` rather than components/skeletons.jsx, which
 * predates it and hardcodes light-mode greys.
 */
export function FormPageSkeleton({ fields = 6, withLineItems = true }) {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-md shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>

        {withLineItems && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <Skeleton className="h-10 col-span-5" />
                <Skeleton className="h-10 col-span-2" />
                <Skeleton className="h-10 col-span-2" />
                <Skeleton className="h-10 col-span-3" />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  );
}

export default FormPageSkeleton;
