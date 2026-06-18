/**
 * Xero-style opening AR / AP conversion documents.
 *
 * Opening invoices and bills seed the AR/AP subledgers as of the conversion
 * date. The accounting invariant under test: they post ONLY against Opening
 * Balance Equity (Dr AR / Cr OBE for invoices, Dr OBE / Cr AP for bills) and
 * never touch revenue, VAT, COGS, inventory or WHT. Also covers the conversion
 * date gate and that opening docs don't trip the trial-balance lump guard.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Account from "@/app/models/account";
import Invoice from "@/app/models/invoice";
import Bill from "@/app/models/bill";
import JournalEntry from "@/app/models/JournalEntry";
import { seedTenant, seedFiscalPeriod } from "./helpers/fixtures.mjs";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => true) }));

// Unique JE numbers per call (invoice OB-AR + bill OB-AP would otherwise clash).
let seq = 0;
vi.mock("@/lib/utils/server-utils", () => ({
  generateUniqueEntryNumber: vi.fn(async (prefix) => `${prefix}-${++seq}`),
}));

// Keep buildTenantMatch real-ish; only getTenantContext is per-test.
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(),
  buildTenantMatch: (companyId) => ({ companyId }),
}));

import { getTenantContext } from "@/lib/utils/tenant-utils";
const {
  setConversionDate,
  createOpeningInvoice,
  createOpeningBill,
  postOpeningBalances,
} = await import("@/app/mongodb/actions/opening-balance-actions");

const CONV = "2026-01-31";
const DOC = "2026-01-15";

describe("opening AR / AP conversion documents", () => {
  let tenant;

  beforeEach(async () => {
    seq = 0;
    tenant = await seedTenant();
    // Fixture COA has no Opening Balance Equity — add the plug account.
    await Account.create({
      companyId: tenant.company._id,
      accountCode: "3500",
      accountName: "Opening Balance Equity",
      accountType: "equity",
      subType: "capital",
      canPost: true,
      isActive: true,
      systemAccount: "opening_balance_equity",
    });
    getTenantContext.mockResolvedValue({
      user: { role: "Admin", name: "Tester", id: "u1" },
      companyId: tenant.company._id,
      isSuperAdmin: false,
    });
    // A fiscal period for January 2026 (doc/conversion month).
    await seedFiscalPeriod(tenant.company._id, 2026, 1, "open");
  });

  it("opening invoice posts ONLY Dr AR / Cr OBE", async () => {
    await setConversionDate({ date: CONV });
    const res = await createOpeningInvoice({
      customerId: tenant.customer._id.toString(),
      invoiceDate: DOC,
      dueDate: "2026-02-15",
      amount: 50_000,
    });
    expect(res.success).toBe(true);

    const invoice = await Invoice.findOne({ invoiceNumber: res.invoiceNumber }).lean();
    expect(invoice.isOpeningBalance).toBe(true);
    expect(invoice.status).toBe("completed");
    expect(invoice.paymentStatus).toBe("unpaid");
    expect(invoice.items).toHaveLength(0);

    const je = await JournalEntry.findOne({
      "relatedDocuments.invoiceId": invoice._id,
    }).lean();
    expect(je.entryType).toBe("opening_balance");
    expect(je.status).toBe("posted");
    expect(je.lines).toHaveLength(2);

    const ar = je.lines.find((l) => l.accountCode === "1100");
    const obe = je.lines.find((l) => l.accountCode === "3500");
    expect(ar.debit).toBeCloseTo(50_000, 2);
    expect(obe.credit).toBeCloseTo(50_000, 2);

    // No revenue / VAT / COGS lines.
    expect(je.lines.some((l) => l.accountCode === "4000")).toBe(false); // sales
    expect(je.lines.some((l) => l.accountCode === "2100")).toBe(false); // VAT output
    expect(je.lines.some((l) => l.accountCode === "5000")).toBe(false); // COGS
    // And exactly one JE for this invoice (no separate sale/COGS entry).
    const count = await JournalEntry.countDocuments({ "relatedDocuments.invoiceId": invoice._id });
    expect(count).toBe(1);
  });

  it("opening bill posts ONLY Dr OBE / Cr AP", async () => {
    await setConversionDate({ date: CONV });
    const res = await createOpeningBill({
      supplierId: tenant.supplier._id.toString(),
      billDate: DOC,
      dueDate: "2026-02-20",
      amount: 30_000,
    });
    expect(res.success).toBe(true);

    const bill = await Bill.findOne({ billNumber: res.billNumber }).lean();
    expect(bill.isOpeningBalance).toBe(true);
    expect(bill.status).toBe("approved");
    expect(bill.amounts.netPayable).toBeCloseTo(30_000, 2);
    expect(bill.amounts.vat).toBe(0);
    expect(bill.amounts.wht).toBe(0);

    const je = await JournalEntry.findOne({
      "relatedDocuments.billId": bill._id,
    }).lean();
    expect(je.entryType).toBe("opening_balance");
    expect(je.lines).toHaveLength(2);
    const obe = je.lines.find((l) => l.accountCode === "3500");
    const ap = je.lines.find((l) => l.accountCode === "2000");
    expect(obe.debit).toBeCloseTo(30_000, 2);
    expect(ap.credit).toBeCloseTo(30_000, 2);
    // No inventory / VAT input / WHT lines.
    expect(je.lines.some((l) => l.accountCode === "1200")).toBe(false); // inventory
    expect(je.lines.some((l) => l.accountCode === "1300")).toBe(false); // VAT input
    expect(je.lines.some((l) => l.accountCode === "2200")).toBe(false); // WHT payable
  });

  it("requires a conversion date before entering opening docs", async () => {
    const res = await createOpeningInvoice({
      customerId: tenant.customer._id.toString(),
      invoiceDate: DOC,
      amount: 1_000,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/conversion/i);
  });

  it("rejects a document dated after the conversion date", async () => {
    await setConversionDate({ date: CONV });
    const res = await createOpeningInvoice({
      customerId: tenant.customer._id.toString(),
      invoiceDate: "2026-02-10", // after CONV
      amount: 1_000,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/on or before/i);
  });

  it("opening AR/AP docs do NOT block the trial-balance lump", async () => {
    await setConversionDate({ date: CONV });
    await createOpeningInvoice({
      customerId: tenant.customer._id.toString(),
      invoiceDate: DOC,
      amount: 50_000,
    });

    // The lump should still post — it's distinguished from opening docs by
    // having no relatedDocuments.
    const res = await postOpeningBalances({
      entryDate: CONV,
      lines: [{ accountId: tenant.accounts.bank_main._id.toString(), debit: 1_000, credit: 0 }],
    });
    expect(res.success).toBe(true);
  });
});
