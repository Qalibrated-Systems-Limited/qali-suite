/**
 * The capability map, and the agreement it exists to enforce.
 *
 * ── THE BUG CLASS THIS REPLACES ────────────────────────────────────────────
 *
 * Three incidents in one week, all the same shape: a page admitted a role that
 * the action behind it refused, because the permission was written down twice
 * and the copies drifted.
 *
 *   * Manager -> AdminDashboard -> a tile gated on INVOICE_WRITE_ROLES, which
 *     had no Manager. Error page on login, for every Manager.
 *   * Settings -> Payroll listed HR Manager in its own ALLOWED array while
 *     CONFIG_ROLES — guarding the page's only loader — did not.
 *   * The sidebar's hasMod() existed and the modules from another branch
 *     never called it.
 *
 * A test that varies the PAYLOAD would not have caught any of them. Each of
 * these varies the ROLE, which is what was actually wrong.
 *
 * No database: the capability map is a pure module, so this runs everywhere.
 */
import { describe, it, expect } from "vitest";

import {
  CAPABILITIES,
  ALL_CAPABILITIES,
  ROLES,
  can,
  rolesFor,
  capabilitiesOf,
} from "@/lib/capabilities";

describe("the capability map", () => {
  it("names only roles that can actually be held", () => {
    /**
     * A TYPO IN A ROLE STRING IS A SILENT DENIAL, which is the failure mode
     * that took three incidents to notice. The authority is the users_role_valid
     * CHECK as 0039 left it — Technician, CEO, HR and User were retired into
     * Employee, Viewer and HR Manager, and anything still naming them would
     * grant nothing to nobody while looking deliberate.
     */
    const unknown = [];
    for (const [capability, roles] of Object.entries(CAPABILITIES)) {
      for (const role of roles) {
        if (!ROLES.includes(role)) unknown.push(`${capability}: "${role}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("gives every capability at least one holder", () => {
    // A capability nobody holds is a feature nobody can reach. If that is
    // intended it should not be in the map at all.
    const orphans = ALL_CAPABILITIES.filter((c) => CAPABILITIES[c].length === 0);
    expect(orphans).toEqual([]);
  });

  it("hands out copies, so a caller cannot edit the map", () => {
    const first = rolesFor("invoice.write");
    first.push("Storekeeper");
    expect(rolesFor("invoice.write")).not.toContain("Storekeeper");
  });

  it("refuses an unknown capability loudly", () => {
    // Rather than denying quietly, which is how a typo survives a code review.
    expect(() => can("Admin", "invoice.wrte")).toThrow(/Unknown capability/);
    expect(() => rolesFor("nope")).toThrow(/Unknown capability/);
  });

  it("lets SuperAdmin through everything, and nobody without a role", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can("SuperAdmin", capability)).toBe(true);
      expect(can(undefined, capability)).toBe(false);
      expect(can("", capability)).toBe(false);
    }
    expect(capabilitiesOf("SuperAdmin")).toEqual([...ALL_CAPABILITIES]);
  });

  it("keeps a Storekeeper to custody, not to the books", () => {
    // The segregation of duties lib/permissions.js describes: physical custody
    // without pricing or ledger authority. Asserted here because it is the one
    // property somebody widening a list by hand is most likely to break.
    expect(can("Storekeeper", "stockcount.count")).toBe(true);
    expect(can("Storekeeper", "adjustment.create")).toBe(true);
    expect(can("Storekeeper", "pricing.edit")).toBe(false);
    expect(can("Storekeeper", "invoice.write")).toBe(false);
    expect(can("Storekeeper", "finance.write")).toBe(false);
    expect(can("Storekeeper", "payroll.rates.write")).toBe(false);
  });
});

/**
 * ── THE PAIRS THAT BROKE ───────────────────────────────────────────────────
 *
 * Each of these is a real incident, written as the invariant that would have
 * stopped it. They are deliberately literal: a page's gate and the gate of the
 * action it calls, asserted to agree.
 */
describe("pages and the actions behind them", () => {
  it("does not require write authority to read a dashboard tile", () => {
    /**
     * The regression, stated as the rule it broke.
     *
     * DASHBOARD_FOR_ROLE routes Manager to AdminDashboard, whose finance tab
     * lists overdue invoices. That list was gated on INVOICE_WRITE_ROLES — a
     * list named for who may WRITE one — so the tile threw for every Manager
     * and took the page with it.
     *
     * Manager still cannot write an invoice, and should not be able to. The
     * point is that reading a collections list on a dashboard is not writing
     * one, so it is gated on being signed in and scoped by row-level security
     * rather than by this map at all. If somebody ever re-gates that tile,
     * this is the assertion that says which capability it must NOT be.
     */
    expect(can("Manager", "invoice.write")).toBe(false);
    expect(can("Store Manager", "invoice.write")).toBe(false);

    // The roles AdminDashboard's own guard admits are a superset of who may
    // write invoices — which is exactly why the tile cannot use that gate.
    const admitted = ["Admin", "Manager", "Store Manager", "Accountant"];
    const canWrite = admitted.filter((r) => can(r, "invoice.write"));
    expect(canWrite.length).toBeLessThan(admitted.length);
  });

  it("gives HR the payroll rates and withholds the GL mapping", () => {
    // Settings -> Payroll admits HR Manager. The rates are preparing payroll;
    // which accounts the journal posts to is an accounting decision.
    expect(can("HR Manager", "payroll.rates.write")).toBe(true);
    expect(can("HR Manager", "payroll.prepare")).toBe(true);
    expect(can("HR Manager", "payroll.gl.write")).toBe(false);

    // And the page must still open for everyone else it lists.
    for (const role of ["Admin", "CFO", "Finance Manager"]) {
      expect(can(role, "payroll.rates.write")).toBe(true);
      expect(can(role, "payroll.gl.write")).toBe(true);
    }
  });

  it("keeps the KPI lists identical everywhere, having had five copies", () => {
    // kpi-actions.ts plus four page files each declared their own array.
    expect(rolesFor("kpi.enter")).toEqual(
      expect.arrayContaining(rolesFor("kpi.manage")),
    );
    // Entering a figure is broader than managing the definition, by exactly
    // the Accountant.
    expect(can("Accountant", "kpi.enter")).toBe(true);
    expect(can("Accountant", "kpi.manage")).toBe(false);
  });

  it("offers the create button only to somebody who can actually create", () => {
    /*
     * /dashboard/select-company shows "Create a company" to whoever holds
     * `company.create`, and the create page itself refuses anyone but a
     * SuperAdmin. A button that leads to a refusal is the same fault as a page
     * that admits a role its action rejects, so the two are one capability.
     */
    expect(can("SuperAdmin", "company.create")).toBe(true);
    for (const role of ["Admin", "CFO", "Finance Manager", "HR Manager", "Manager"]) {
      expect(can(role, "company.create")).toBe(false);
    }
  });

  it("keeps closing a period apart from reopening and locking one", () => {
    // Closing is routine month-end. Reopening moves the line between settled
    // and unsettled books after somebody signed them off; locking is final.
    expect(can("Accountant", "fiscal.manage")).toBe(true);
    expect(can("Accountant", "fiscal.reopen")).toBe(false);
    expect(can("Finance Manager", "fiscal.reopen")).toBe(true);
    expect(can("Finance Manager", "fiscal.lock")).toBe(false);
    expect(can("CFO", "fiscal.lock")).toBe(true);
  });
});
