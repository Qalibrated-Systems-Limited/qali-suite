/**
 * Regression: the account parent field must actually persist.
 *
 * The form submitted `parentId`, the Zod schema validated `parentId`, and
 * createAccount() spread that into Account.create(). The Mongoose schema path
 * is `parentAccount`, and strict mode silently discards unknown paths — so the
 * selected parent was thrown away on every save and getAccountHierarchy(),
 * which also read `parentId`, returned a completely flat tree.
 *
 * The failure was invisible: the validation immediately before the save does
 * look the parent up and check its type, so the UI reported success.
 *
 * These tests fail against the old field names.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Account from "@/app/models/account";
import { seedTenant } from "./helpers/fixtures.mjs";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => true) }));
// Mocked wholesale rather than partially: the real module imports next-auth,
// which pulls in next/server and fails to resolve under vitest. The two pure
// helpers account-actions uses are reimplemented here to match production
// semantics (see lib/utils/tenant-utils.js).
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(),
  withTenantScope: (query, companyId, isSuperAdmin) =>
    isSuperAdmin ? query : { ...query, companyId },
  getCompanyIdForCreate: (explicitCompanyId, userCompanyId) =>
    explicitCompanyId || userCompanyId,
}));

import { getTenantContext } from "@/lib/utils/tenant-utils";
const { createAccount, getAccountHierarchy } = await import(
  "@/app/mongodb/actions/account-actions"
);

/** Mirrors how the account form posts its fields. */
function formDataFor(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.set(k, String(v));
  }
  return fd;
}

describe("account parent hierarchy", () => {
  let tenant, header;

  beforeEach(async () => {
    tenant = await seedTenant();
    getTenantContext.mockResolvedValue({
      user: { id: String(tenant.user._id), name: tenant.user.name, role: "Admin" },
      companyId: tenant.company._id,
      isSuperAdmin: false,
    });

    header = await Account.create({
      companyId: tenant.company._id,
      accountCode: "6000",
      accountName: "Operating Expenses",
      accountType: "expense",
      subType: "header",
      canPost: false,
      isActive: true,
    });
  });

  it("persists the selected parent onto parentAccount", async () => {
    const result = await createAccount(
      {},
      formDataFor({
        accountCode: "6100",
        accountName: "Rent",
        accountType: "expense",
        subType: "operating_expense",
        parentAccount: String(header._id),
      }),
    );

    expect(result.errors).toBeUndefined();

    const saved = await Account.findOne({
      companyId: tenant.company._id,
      accountCode: "6100",
    }).lean();

    expect(saved).toBeTruthy();
    // The assertion that used to fail: parentAccount was null because the
    // incoming `parentId` key matched no schema path.
    expect(saved.parentAccount).not.toBeNull();
    expect(String(saved.parentAccount)).toBe(String(header._id));
  });

  it("nests the child under its parent in the hierarchy", async () => {
    await createAccount(
      {},
      formDataFor({
        accountCode: "6100",
        accountName: "Rent",
        accountType: "expense",
        subType: "operating_expense",
        parentAccount: String(header._id),
      }),
    );

    const { success, accounts } = await getAccountHierarchy();
    expect(success).toBe(true);

    const parentNode = accounts.find((a) => a.accountCode === "6000");
    expect(parentNode).toBeTruthy();

    // Previously both accounts came back as roots with no children.
    expect(parentNode.children.map((c) => c.accountCode)).toContain("6100");
    expect(accounts.some((a) => a.accountCode === "6100")).toBe(false);
  });

  it("rejects a non-header parent", async () => {
    const postable = await Account.create({
      companyId: tenant.company._id,
      accountCode: "6200",
      accountName: "Utilities",
      accountType: "expense",
      subType: "operating_expense",
      canPost: true,
      isActive: true,
    });

    const result = await createAccount(
      {},
      formDataFor({
        accountCode: "6210",
        accountName: "Electricity",
        accountType: "expense",
        subType: "operating_expense",
        parentAccount: String(postable._id),
      }),
    );

    // The error key must match what accountForm.jsx reads, or the message is
    // validated but never shown.
    expect(result.errors?.parentAccount?.[0]).toMatch(/header account/i);
  });

  it("rejects a parent whose account type differs", async () => {
    const assetHeader = await Account.create({
      companyId: tenant.company._id,
      accountCode: "1900",
      accountName: "Assets",
      accountType: "asset",
      subType: "header",
      canPost: false,
      isActive: true,
    });

    const result = await createAccount(
      {},
      formDataFor({
        accountCode: "6300",
        accountName: "Misplaced",
        accountType: "expense",
        subType: "operating_expense",
        parentAccount: String(assetHeader._id),
      }),
    );

    expect(result.errors?.parentAccount?.[0]).toMatch(/must match account type/i);
  });
});
