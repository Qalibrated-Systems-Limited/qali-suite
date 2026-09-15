import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EyeOff } from "lucide-react";

/**
 * This section is not part of what this KIND of project does — 0082.
 *
 * NOT an error and not a permission refusal, and the wording matters: the
 * reader has not done anything wrong and nothing is being withheld from them.
 * A supply-only job has no site diary because no standard says it should have
 * one, and the fix — if it is wrong — is to change the project's type, which is
 * why that is the button.
 *
 * Shown by the page rather than only hidden from the nav, because hiding a link
 * is a sign on an unlocked door.
 */
export default function SectionNotForType({ section, project, typeName }) {
  return (
    <Card className="p-5 sm:p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <EyeOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="font-semibold text-lg mb-1">
        {section} isn&apos;t part of this project
      </h2>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
        {project?.name}
        {typeName ? ` is a ${typeName.toLowerCase()} project` : " has a type"},
        and {section.toLowerCase()} isn&apos;t one of the sections that kind of
        work uses. Change the project&apos;s type if that isn&apos;t right.
      </p>
      {project?.id && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/dashboard/projects/${project.id}/edit`}>
            Change project type
          </Link>
        </Button>
      )}
    </Card>
  );
}
