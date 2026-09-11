import { getSwitchableCompanies } from "@/app/db/actions/company-switch-actions";
import { CompanySwitcherMenu } from "@/components/company-switcher";

/**
 * Reads the user's grants and hands them to the menu.
 *
 * Server-side because the grants are a Postgres read scoped to the user, and
 * because "which company is active" lives in the session cookie, which no
 * client hook in this app can see.
 *
 * Never throws into the layout: a signed-out user, or a Postgres that is not
 * reachable, means no switcher — not a dashboard that will not render.
 *
 * TAKES THE GRANTS AS PROPS WHEN THE CALLER ALREADY HAS THEM. The dashboard
 * layout reads them to decide whether to show the company chooser, and a
 * second identical query to draw the menu beside it is a second query for an
 * answer already in hand.
 */
export async function CompanySwitcher({ className, grants }) {
  let companies = grants?.companies ?? [];
  let activeCompanyId = grants?.activeCompanyId ?? null;

  if (!grants) {
    try {
      const result = await getSwitchableCompanies();
      companies = result.companies ?? [];
      activeCompanyId = result.activeCompanyId ?? null;
    } catch {
      return null;
    }
  }

  return (
    <CompanySwitcherMenu
      companies={companies}
      activeCompanyId={activeCompanyId}
      className={className}
    />
  );
}
