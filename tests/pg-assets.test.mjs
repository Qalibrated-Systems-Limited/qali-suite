/**
 * Fixed assets: the three entries, and what the register says afterwards.
 *
 * All three went into the Mongo ledger while every ledger screen read
 * Postgres, so depreciation, impairment and disposal were invisible to the
 * trial balance. Each posting below asserts the entry exists IN THIS LEDGER
 * and balances.
 *
 * The rest is the invariants 0056 added, each named after the thing in
 * asset-actions.js it replaces.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { userMessage } = await import("@/app/db/errors");
const assetsRepo = await import("@/app/db/repositories/assets");

suite("fixed assets", () => {
  let admin, client, db, companyA;
  let assetAcct, accumDepAcct, depExpenseAcct, bankAcct, gainAcct, lossAcct, impairAcct;

  const asTenant = (c, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${c}, true)`);
      return fn(tx);
    });

  const entryTotals = async (entryId) => {
    const [r] = await admin`
      SELECT COALESCE(SUM(debit),0)::float8 AS d, COALESCE(SUM(credit),0)::float8 AS c
        FROM journal_lines WHERE entry_id = ${entryId}::uuid`;
    return { debits: r.d, credits: r.c };
  };
  const lineFor = async (entryId, accountId) => {
    const [r] = await admin`
      SELECT debit::float8 AS debit, credit::float8 AS credit
        FROM journal_lines
       WHERE entry_id = ${entryId}::uuid AND account_id = ${accountId}::uuid`;
    return r ?? null;
  };
  const failsWith = async (fn, pattern) => {
    const err = await fn().then(
      () => { throw new Error("expected a rejection"); },
      (e) => e,
    );
    expect(userMessage(err)).toMatch(pattern);
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;
    companyA = randomUUID();
    assetAcct = randomUUID(); accumDepAcct = randomUUID(); depExpenseAcct = randomUUID();
    bankAcct = randomUUID(); gainAcct = randomUUID(); lossAcct = randomUUID(); impairAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${assetAcct}::uuid,      ${companyA}::uuid, '1500', 'Motor Vehicles',        'asset',     true, NULL),
          (${accumDepAcct}::uuid,   ${companyA}::uuid, '1590', 'Accumulated Dep.',      'asset',     true, NULL),
          (${depExpenseAcct}::uuid, ${companyA}::uuid, '6500', 'Depreciation Expense',  'expense',   true, NULL),
          (${bankAcct}::uuid,       ${companyA}::uuid, '1010', 'Bank',                  'asset',     true, NULL),
          (${gainAcct}::uuid,       ${companyA}::uuid, '4900', 'Gain on Disposal',      'revenue',   true, NULL),
          (${lossAcct}::uuid,       ${companyA}::uuid, '6900', 'Loss on Disposal',      'expense',   true, NULL),
          (${impairAcct}::uuid,     ${companyA}::uuid, '6910', 'Impairment Loss',       'expense',   true, NULL)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        SELECT ${companyA}::uuid, y, m,
               to_char(make_date(y, m, 1), 'FMMonth YYYY'),
               to_char(make_date(y, m, 1), 'YYYY-MM'),
               make_date(y, m, 1),
               (make_date(y, m, 1) + interval '1 month - 1 day')::date,
               'open'
          FROM generate_series(2026, 2032) AS y, generate_series(1, 12) AS m`);
    });
  });

  /** 1,200,000 over 60 months, no salvage: 20,000 a month exactly. */
  const vehicle = (tx, over = {}) =>
    assetsRepo.createAsset(tx, {
      companyId: companyA,
      name: "Toyota Hilux",
      category: "vehicle",
      acquisitionDate: "2026-01-01",
      acquisitionCost: "1200000.0000",
      depreciationStartDate: "2026-01-01",
      usefulLifeMonths: 60,
      assetAccountId: assetAcct,
      accumulatedDepreciationAccountId: accumDepAcct,
      depreciationExpenseAccountId: depExpenseAcct,
      ...over,
    });

  // A function, not a const object: the ids are assigned in beforeEach, and a
  // literal evaluated in the describe body would capture undefined.
  const depAccounts = () => ({
    depreciationExpenseAccountId: depExpenseAcct,
    accumulatedDepreciationAccountId: accumDepAcct,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Creation
  // ───────────────────────────────────────────────────────────────────────────

  it("registers an asset, lays out its schedule, and posts NOTHING", async () => {
    const { asset, schedule, entries } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      return {
        asset: await assetsRepo.getAsset(tx, created.id),
        schedule: await assetsRepo.listSchedule(tx, created.id),
        entries: await tx.execute(sql`SELECT count(*)::int AS n FROM journal_entries`),
      };
    });

    expect(asset.assetNumber).toMatch(/^AST-/);
    expect(schedule).toHaveLength(60);
    expect(Number(schedule[0].depreciationAmount)).toBe(20000);
    expect(asset.bookValue).toBe(1200000);
    expect(asset.accumulatedDepreciation).toBe(0);
    // Acquisition raises no entry — the bill already posted DR Asset / CR AP.
    expect(entries[0].n).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The three postings
  // ───────────────────────────────────────────────────────────────────────────

  it("depreciation debits the expense and credits accumulated, in THIS ledger", async () => {
    const { result, asset } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      const result = await assetsRepo.postDepreciationForAsset(
        tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      return { result, asset: await assetsRepo.getAsset(tx, created.id) };
    });

    expect(await entryTotals(result.entry.id)).toEqual({ debits: 20000, credits: 20000 });
    expect(await lineFor(result.entry.id, depExpenseAcct)).toMatchObject({ debit: 20000 });
    expect(await lineFor(result.entry.id, accumDepAcct)).toMatchObject({ credit: 20000 });

    const [posted] = await admin`
      SELECT status, entry_type, source_type, entry_date::text
        FROM journal_entries WHERE id = ${result.entry.id}::uuid`;
    expect(posted).toMatchObject({
      status: "posted", entry_type: "depreciation", source_type: "fixed_asset",
    });
    // Dated the last day of the period, as Mongo dates it.
    expect(posted.entry_date).toBe("2026-01-31");

    expect(asset.accumulatedDepreciation).toBe(20000);
    expect(asset.bookValue).toBe(1180000);
  });

  it("impairment debits the loss and credits accumulated, then re-spreads the rest", async () => {
    const { result, asset, schedule } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      const result = await assetsRepo.impairAsset(tx, created.id, {
        amount: "180000.0000",
        reason: "Accident damage, written down to recoverable amount",
        accounts: {
          impairmentLossAccountId: impairAcct,
          accumulatedDepreciationAccountId: accumDepAcct,
        },
        by: { name: "Fay" },
      });
      return {
        result,
        asset: await assetsRepo.getAsset(tx, created.id),
        schedule: await assetsRepo.listSchedule(tx, created.id),
      };
    });

    expect(await lineFor(result.entry.id, impairAcct)).toMatchObject({ debit: 180000 });
    expect(await lineFor(result.entry.id, accumDepAcct)).toMatchObject({ credit: 180000 });

    // 1,200,000 - 20,000 depreciated - 180,000 impaired.
    expect(asset.accumulatedDepreciation).toBe(200000);
    expect(asset.bookValue).toBe(1000000);

    // The posted month is untouched; the remaining 59 carry the new amount.
    expect(schedule[0].status).toBe("posted");
    expect(Number(schedule[0].depreciationAmount)).toBe(20000);
    const remaining = schedule.filter((s) => s.status === "pending");
    expect(remaining).toHaveLength(59);
    // 1,000,000 re-spread over 59 months.
    expect(Number(remaining[0].depreciationAmount)).toBe(Math.round(1_000_000 / 59));
    const respread = remaining.reduce((s, r) => s + Number(r.depreciationAmount), 0);
    expect(respread).toBe(1_000_000);
  });

  it("a disposal at a loss clears cost and depreciation and books the shortfall", async () => {
    const { result } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      for (const p of ["2026-01", "2026-02", "2026-03"]) {
        await assetsRepo.postDepreciationForAsset(tx, created.id, p, depAccounts(), { name: "Fay" });
      }
      // Book value 1,140,000 after three months; sold for 1,000,000.
      const result = await assetsRepo.disposeAsset(tx, created.id, {
        disposalMethod: "sold",
        disposalAmount: "1000000.0000",
        disposalDate: "2026-04-15",
        accounts: {
          assetAccountId: assetAcct,
          accumulatedDepreciationAccountId: accumDepAcct,
          bankAccountId: bankAcct,
          gainAccountId: gainAcct,
          lossAccountId: lossAcct,
        },
        by: { name: "Fay" },
      });
      return { result };
    });

    expect(result.bookValue).toBe(1140000);
    expect(result.gainOrLoss).toBe(-140000);
    expect(await entryTotals(result.entry.id)).toEqual({ debits: 1200000, credits: 1200000 });
    expect(await lineFor(result.entry.id, bankAcct)).toMatchObject({ debit: 1000000 });
    expect(await lineFor(result.entry.id, accumDepAcct)).toMatchObject({ debit: 60000 });
    expect(await lineFor(result.entry.id, lossAcct)).toMatchObject({ debit: 140000 });
    expect(await lineFor(result.entry.id, assetAcct)).toMatchObject({ credit: 1200000 });
    expect(await lineFor(result.entry.id, gainAcct)).toBeNull();
  });

  it("a disposal at a gain books the excess", async () => {
    const { result } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      // Book value 1,180,000; sold for 1,300,000.
      return {
        result: await assetsRepo.disposeAsset(tx, created.id, {
          disposalMethod: "sold",
          disposalAmount: "1300000.0000",
          accounts: {
            assetAccountId: assetAcct,
            accumulatedDepreciationAccountId: accumDepAcct,
            bankAccountId: bankAcct,
            gainAccountId: gainAcct,
            lossAccountId: lossAcct,
          },
          by: { name: "Fay" },
        }),
      };
    });

    expect(result.gainOrLoss).toBe(120000);
    expect(await lineFor(result.entry.id, gainAcct)).toMatchObject({ credit: 120000 });
    expect(await lineFor(result.entry.id, lossAcct)).toBeNull();
  });

  it("a scrapped asset writes the whole book value off", async () => {
    const { result } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      return {
        result: await assetsRepo.disposeAsset(tx, created.id, {
          disposalMethod: "scrapped",
          accounts: {
            assetAccountId: assetAcct,
            accumulatedDepreciationAccountId: accumDepAcct,
            lossAccountId: lossAcct,
          },
          by: { name: "Fay" },
        }),
      };
    });
    expect(result.gainOrLoss).toBe(-1200000);
    expect(await lineFor(result.entry.id, lossAcct)).toMatchObject({ debit: 1200000 });
    expect(await lineFor(result.entry.id, assetAcct)).toMatchObject({ credit: 1200000 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The invariants
  // ───────────────────────────────────────────────────────────────────────────

  it("a period cannot be depreciated twice", async () => {
    const second = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      // The month-end job run twice. In Mongo the guard is a find-then-write
      // that two concurrent runs both pass; here the row is no longer pending.
      return assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
    });
    expect(second).toBeNull();

    const [n] = await admin`SELECT count(*)::int AS n FROM journal_entries WHERE entry_type = 'depreciation'`;
    expect(n.n).toBe(1);
  });

  it("the register cannot claim depreciation the ledger has not seen", async () => {
    // THE correction. Post March having missed January and February. Mongo
    // takes accumulated depreciation off the SCHEDULE ROW, which projects all
    // three months, so the register would say 60,000 while the ledger held
    // 20,000. Here it is a sum over what was posted.
    const { asset, ledger } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-03", depAccounts(), { name: "Fay" });
      return {
        asset: await assetsRepo.getAsset(tx, created.id),
        ledger: await tx.execute(sql`
          SELECT COALESCE(SUM(credit), 0)::float8 AS n FROM journal_lines
           WHERE account_id = ${accumDepAcct}::uuid`),
      };
    });

    expect(asset.accumulatedDepreciation).toBe(20000);
    expect(Number(ledger[0].n)).toBe(20000);
    expect(asset.bookValue).toBe(1180000);
    // And the two months that fell through are counted, which nothing could
    // see before.
    expect(asset.periodsMissed).toBe(2);
  });

  it("a posted period can no longer be changed", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await vehicle(tx);
          await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
          return tx.execute(sql`
            UPDATE asset_depreciation_schedule SET depreciation_amount = 1
             WHERE asset_id = ${created.id}::uuid AND period = '2026-01'`);
        }),
      /posted to the ledger and can no longer be changed/i,
    );
  });

  it("an asset is disposed of once", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await vehicle(tx);
          const accounts = {
            assetAccountId: assetAcct,
            accumulatedDepreciationAccountId: accumDepAcct,
            lossAccountId: lossAcct,
          };
          await assetsRepo.disposeAsset(tx, created.id, {
            disposalMethod: "scrapped", accounts, by: { name: "Fay" },
          });
          return assetsRepo.disposeAsset(tx, created.id, {
            disposalMethod: "scrapped", accounts, by: { name: "Fay" },
          });
        }),
      /already been disposed of/i,
    );
  });

  it("nothing is recorded against a disposed asset", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await vehicle(tx);
          await assetsRepo.disposeAsset(tx, created.id, {
            disposalMethod: "scrapped",
            accounts: {
              assetAccountId: assetAcct,
              accumulatedDepreciationAccountId: accumDepAcct,
              lossAccountId: lossAcct,
            },
            by: { name: "Fay" },
          });
          return assetsRepo.impairAsset(tx, created.id, {
            amount: "1000.0000", reason: "Too late for this",
            accounts: {
              impairmentLossAccountId: impairAcct,
              accumulatedDepreciationAccountId: accumDepAcct,
            },
            by: { name: "Fay" },
          });
        }),
      /disposed|cannot be impaired/i,
    );
  });

  it("disposal marks the remaining months as never-to-be-charged", async () => {
    const schedule = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      await assetsRepo.disposeAsset(tx, created.id, {
        disposalMethod: "scrapped",
        accounts: {
          assetAccountId: assetAcct,
          accumulatedDepreciationAccountId: accumDepAcct,
          lossAccountId: lossAcct,
        },
        by: { name: "Fay" },
      });
      return assetsRepo.listSchedule(tx, created.id);
    });
    expect(schedule.filter((s) => s.status === "pending")).toHaveLength(0);
    expect(schedule.filter((s) => s.status === "posted")).toHaveLength(1);
    expect(schedule.filter((s) => s.status === "skipped")).toHaveLength(59);
  });

  it("an impairment cannot take an asset below its salvage value", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await vehicle(tx, { salvageValue: "200000.0000" });
          return assetsRepo.impairAsset(tx, created.id, {
            amount: "1100000.0000",
            reason: "Trying to write off more than there is",
            accounts: {
              impairmentLossAccountId: impairAcct,
              accumulatedDepreciationAccountId: accumDepAcct,
            },
            by: { name: "Fay" },
          });
        }),
      /below its salvage value/i,
    );
  });

  it("terms cannot be changed once depreciation has been posted", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await vehicle(tx);
          await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
          // Shortening the life would rewrite months the ledger has seen.
          return assetsRepo.updateAsset(tx, created.id, { usefulLifeMonths: 24 });
        }),
      /can no longer be changed|Impair it instead/i,
    );
  });

  it("editing an asset before anything posts re-lays the schedule", async () => {
    const schedule = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.updateAsset(tx, created.id, { usefulLifeMonths: 24 });
      return assetsRepo.listSchedule(tx, created.id);
    });
    expect(schedule).toHaveLength(24);
    expect(Number(schedule[0].depreciationAmount)).toBe(50000);
  });

  it("cancelling a posting reverses the entry and frees the period", async () => {
    const { before, after, schedule, entries } = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      const before = await assetsRepo.getAsset(tx, created.id);

      await assetsRepo.cancelDepreciationPosting(tx, created.id, "2026-01", {
        reason: "Posted to the wrong period",
        by: { name: "Fay" },
      });

      return {
        before,
        after: await assetsRepo.getAsset(tx, created.id),
        schedule: await assetsRepo.listSchedule(tx, created.id),
        entries: await tx.execute(sql`
          SELECT COALESCE(SUM(credit - debit), 0)::float8 AS net FROM journal_lines
           WHERE account_id = ${accumDepAcct}::uuid`),
      };
    });

    expect(before.accumulatedDepreciation).toBe(20000);
    // The register stops counting it...
    expect(after.accumulatedDepreciation).toBe(0);
    expect(after.bookValue).toBe(1200000);
    // ...and the ledger nets to zero for that period, rather than being edited.
    expect(Number(entries[0].net)).toBe(0);
    // The month is free to be posted again.
    expect(schedule[0].status).toBe("pending");
    expect(schedule[0].journalEntryId).toBeNull();
  });

  it("only the most recent posted period can be cancelled", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await vehicle(tx);
          await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
          await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-02", depAccounts(), { name: "Fay" });
          // Cancelling January would leave a hole mid-schedule.
          return assetsRepo.cancelDepreciationPosting(tx, created.id, "2026-01", {
            by: { name: "Fay" },
          });
        }),
      /most recent posted period/i,
    );
  });

  it("a cancelled period can be posted again", async () => {
    const asset = await asTenant(companyA, async (tx) => {
      const created = await vehicle(tx);
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      await assetsRepo.cancelDepreciationPosting(tx, created.id, "2026-01", { by: { name: "Fay" } });
      await assetsRepo.postDepreciationForAsset(tx, created.id, "2026-01", depAccounts(), { name: "Fay" });
      return assetsRepo.getAsset(tx, created.id);
    });
    expect(asset.accumulatedDepreciation).toBe(20000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Derived state
  // ───────────────────────────────────────────────────────────────────────────

  it("reports the residue reducing balance will never charge", async () => {
    const asset = await asTenant(companyA, async (tx) => {
      const created = await assetsRepo.createAsset(tx, {
        companyId: companyA, name: "Excavator", category: "machinery",
        acquisitionDate: "2026-01-01", acquisitionCost: "1000000.0000",
        depreciationStartDate: "2026-01-01", usefulLifeMonths: 60,
        depreciationMethod: "reducing_balance", depreciationRate: "0.250000",
        assetAccountId: assetAcct,
        accumulatedDepreciationAccountId: accumDepAcct,
        depreciationExpenseAccountId: depExpenseAcct,
      });
      const [row] = await tx.execute(sql`
        SELECT unwritten_residue::float8 AS residue FROM asset_state
         WHERE asset_id = ${created.id}::uuid`);
      return row;
    });

    // Reducing balance is asymptotic and the schedule simply stops. Mongo
    // carried this silently; here the register can show it.
    expect(Number(asset.residue)).toBeGreaterThan(0);
    expect(Number(asset.residue)).toBeCloseTo(237305, -3);
  });

  it("the whole life nets to zero across the ledger", async () => {
    await asTenant(companyA, async (tx) => {
      const created = await assetsRepo.createAsset(tx, {
        companyId: companyA, name: "Laptop", category: "computer",
        acquisitionDate: "2026-01-01", acquisitionCost: "120000.0000",
        depreciationStartDate: "2026-01-01", usefulLifeMonths: 12,
        assetAccountId: assetAcct,
        accumulatedDepreciationAccountId: accumDepAcct,
        depreciationExpenseAccountId: depExpenseAcct,
      });
      for (let m = 1; m <= 12; m++) {
        await assetsRepo.postDepreciationForAsset(
          tx, created.id, `2026-${String(m).padStart(2, "0")}`, depAccounts(), { name: "Fay" });
      }
      await assetsRepo.disposeAsset(tx, created.id, {
        disposalMethod: "scrapped",
        disposalDate: "2027-01-10",
        accounts: {
          assetAccountId: assetAcct,
          accumulatedDepreciationAccountId: accumDepAcct,
          lossAccountId: lossAcct,
        },
        by: { name: "Fay" },
      });
    });

    // Fully depreciated then scrapped: accumulated depreciation nets flat, and
    // the asset account nets flat too once the cost is credited out.
    const [accum] = await admin`
      SELECT COALESCE(SUM(debit - credit), 0)::float8 AS net
        FROM journal_lines WHERE account_id = ${accumDepAcct}::uuid`;
    expect(accum.net).toBe(0);

    const [all] = await admin`
      SELECT COALESCE(SUM(debit),0)::float8 AS d, COALESCE(SUM(credit),0)::float8 AS c FROM journal_lines`;
    expect(all.d).toBe(all.c);
  });
});
