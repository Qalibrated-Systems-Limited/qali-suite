/**
 * Sanity check — confirms vitest + mongodb-memory-server + Mongoose all
 * wire up correctly. If this fails, every other test in this directory
 * is doomed; fix the harness before debugging individual tests.
 */
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { seedTenant } from "./helpers/fixtures.mjs";

describe("test harness", () => {
  it("is connected to mongo", () => {
    expect(mongoose.connection.readyState).toBe(1); // 1 = connected
  });

  it("can seed a full tenant bundle", async () => {
    const tenant = await seedTenant();

    expect(tenant.company._id).toBeDefined();
    expect(tenant.user.companyId.toString()).toBe(tenant.company._id.toString());
    expect(tenant.accounts.accounts_payable).toBeDefined();
    expect(tenant.accounts.accounts_payable.accountType).toBe("liability");
    expect(tenant.supplier.type).toBe("supplier");
    expect(tenant.customer.type).toBe("customer");
    expect(tenant.period.status).toBe("open");
  });

  it("truncates collections between tests", async () => {
    // The previous test inserted a tenant. afterEach should have wiped it.
    const Company = mongoose.connection.collection("companies");
    const count = await Company.countDocuments();
    expect(count).toBe(0);
  });
});
