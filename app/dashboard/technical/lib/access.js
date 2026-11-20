import "server-only";
import { canSeeProjectsNav } from "@/lib/permissions";
import { getMyTechnicalStanding } from "@/app/db/actions/technical-actions";

/**
 * What the viewer may do in the Technical pages.
 *
 * The pages used to admit only roles that see the Projects module, which shut
 * out the people who do the work: a technician is usually an Employee in the
 * Technical department. They are admitted now, and write reports; Projects
 * roles still read everything.
 */
export async function technicalViewer(user) {
  let standing = { userId: String(user?.id ?? ""), isManager: false, isTechnician: false };
  try {
    standing = await getMyTechnicalStanding();
  } catch {
    // No company chosen yet, or no tenant: the dashboard layout asks for one.
  }
  return {
    ...standing,
    canView: standing.isTechnician || canSeeProjectsNav(user?.role),
  };
}
