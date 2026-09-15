import { describe, it, expect } from "vitest";
import { getStandardChartOfAccounts } from "@/lib/chart-of-accounts";
import { accountSystemTypes, accountSubType } from "@/lib/utils";

/**
 * The seed and the validator have to agree.
 *
 * THE BUG THIS EXISTS FOR. `retention_receivable` and `project_materials`
 * were added to the chart of accounts in b914571ca and not to
 * `accountSystemTypes`, which is the enum the Mongo Account model validates
 * against. Postgres stores `system_account` as plain text and accepted them
 * without complaint, so every Postgres test passed and the ledger worked —
 * while creating a NEW company, which seeds the same chart into Mongo, failed
 * with `"retention_receivable" is not a valid enum value`.
 *
 * Nothing tied the two lists together, so the only thing that could catch it
 * was somebody creating a company.
 */
describe("chart of accounts", () => {
  const chart = getStandardChartOfAccounts();

  it("has accounts to check", () => {
    expect(chart.length).toBeGreaterThan(0);
  });

  it("uses only systemAccount values the Account model will accept", () => {
    const allowed = new Set(accountSystemTypes);
    const rejected = chart
      .filter((a) => a.systemAccount)
      .filter((a) => !allowed.has(a.systemAccount))
      .map((a) => `${a.accountCode} ${a.accountName} → ${a.systemAccount}`);

    expect(rejected).toEqual([]);
  });

  it("uses only subType values the Account model will accept", () => {
    const allowed = new Set(accountSubType);
    const rejected = chart
      .filter((a) => a.subType)
      .filter((a) => !allowed.has(a.subType))
      .map((a) => `${a.accountCode} ${a.accountName} → ${a.subType}`);

    expect(rejected).toEqual([]);
  });

  it("names each systemAccount at most once", () => {
    const seen = new Map();
    for (const a of chart) {
      if (!a.systemAccount) continue;
      seen.set(a.systemAccount, (seen.get(a.systemAccount) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
    // A company-scoped unique index enforces this in both stores, so a chart
    // that seeds two would fail on the second insert rather than here.
    expect(duplicated).toEqual([]);
  });
});
