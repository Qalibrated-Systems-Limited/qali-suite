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
 */
export async function CompanySwitcher({ className }) {
  let companies = [];
  let activeCompanyId = null;

  try {
    const result = await getSwitchableCompanies();
    companies = result.companies ?? [];
    activeCompanyId = result.activeCompanyId ?? null;
  } catch {
    return null;
  }

  return (
    <CompanySwitcherMenu
      companies={companies}
      activeCompanyId={activeCompanyId}
      className={className}
    />
  );
}
