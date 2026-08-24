import { checkPlanAccess } from "@/lib/plan-gate";
import { UpgradePrompt } from "@/components/upgrade-prompt";

/**
 * The plan gate, as a boundary rather than a call you have to remember.
 *
 * WHY THIS EXISTS. Plan access was enforced by a `requirePlanAccess(...)` call
 * at the top of each gated server action — and the Postgres port did not carry
 * those calls across. `app/mongodb/` has eight files that gate; `app/db/` had
 * none, so every ported module (invoices, bills, payments, accounts, journal,
 * parties, claims, expenses, assets, HR) became reachable on any plan. Not one
 * of the 31 HR pages checked either. The sidebar hid the group and nothing
 * else stopped you: the command palette, a typed URL, or a bookmark all worked.
 *
 * A check that has to be remembered per file gets dropped exactly the way this
 * one did. Wrapping a module's LAYOUT gates every page under it, including the
 * ones nobody has written yet.
 *
 * SERVER-SIDE ON PURPOSE, not in `proxy.ts`. Next's own guidance is that Proxy
 * "should not be used as a full session management or authorization solution" —
 * it is for optimistic checks. `checkPlanAccess` also re-reads the subscription
 * from Postgres, so a company that upgrades is not locked out until its users
 * next sign in, which a token-based check in Proxy could not avoid.
 *
 * This does NOT replace gating writes. A layout guards what a person can open,
 * not what an API route or a server action will do when called directly; those
 * still need their own `requirePlanAccess`.
 *
 * @param {string} module  Module id from lib/plans.js — e.g. "hr", "projects".
 * @param {string} feature Human-readable name for the upgrade screen.
 */
export async function PlanGate({ module, feature, children }) {
  const gate = await checkPlanAccess(module);

  if (!gate.allowed) {
    return (
      <UpgradePrompt
        currentPlan={gate.currentPlan}
        requiredPlan={gate.requiredPlan}
        feature={feature}
        reason={gate.reason}
      />
    );
  }

  return children;
}
