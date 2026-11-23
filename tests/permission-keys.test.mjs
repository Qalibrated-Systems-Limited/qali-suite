/**
 * What a person SEES follows the company's saved Roles & Permissions: the
 * session's `permissionKeys` answer `can()`, `hasRole()` and the nav rules;
 * a role nobody edited (null) follows the code, as before.
 */
import { describe, it, expect } from "vitest";
import { can } from "@/lib/capabilities";
import { hasRole, FINANCE_WRITE_ROLES, HR_ADMIN_ROLES, STOCK_REQUEST_CREATE_ROLES } from "@/lib/utils/role-gates";
import { gateKeysFor, holdsNavKey } from "@/lib/permission-keys";
import { hrNavFor } from "@/lib/nav/hr-nav";

describe("saved permission keys", () => {
  it("an unedited role follows the code", () => {
    const u = { role: "Accountant", permissionKeys: null };
    expect(hasRole(u, FINANCE_WRITE_ROLES)).toBe(FINANCE_WRITE_ROLES.includes("Accountant"));
    expect(can(u, "hr.admin")).toBe(false);
  });

  it("a saved set grants and removes", () => {
    const u = { role: "Accountant", permissionKeys: ["HR_ADMIN_ROLES"] };
    expect(hasRole(u, HR_ADMIN_ROLES)).toBe(true);
    expect(can(u, "hr.admin")).toBe(true);
    expect(hasRole(u, FINANCE_WRITE_ROLES)).toBe(false);
  });

  it("recognises a copied role array", () => {
    expect(gateKeysFor([...FINANCE_WRITE_ROLES])).toContain("FINANCE_WRITE_ROLES");
  });

  it("SuperAdmin passes whatever is saved", () => {
    expect(can({ role: "SuperAdmin", permissionKeys: [] }, "hr.admin")).toBe(true);
  });

  it("nav rules read the catalog label", () => {
    expect(holdsNavKey({ role: "Manager", permissionKeys: ["See HR"] }, "See HR")).toBe(true);
    expect(holdsNavKey({ role: "Manager", permissionKeys: [] }, "See HR")).toBe(false);
    expect(holdsNavKey({ role: "Manager", permissionKeys: null }, "See HR")).toBeNull();
  });

  it("HR Manager can raise requisitions, and it shows in the HR menu", () => {
    expect(STOCK_REQUEST_CREATE_ROLES).toContain("HR Manager");
    const u = { role: "HR Manager", permissionKeys: null };
    const ids = hrNavFor(u, (c) => can(u, c)).flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(expect.arrayContaining(["hr-requisitions", "hr-payroll", "hr-letters", "hr-my-leave"]));
    expect(ids).not.toContain("hr-users"); // the users page is for administrators
  });

  it("an Employee's HR menu is self-service only", () => {
    const u = { role: "Employee", permissionKeys: null };
    const sections = hrNavFor(u, (c) => can(u, c));
    expect(sections.map((s) => s.id)).toEqual(["me"]);
  });
});
