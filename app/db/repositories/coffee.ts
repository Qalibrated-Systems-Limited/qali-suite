import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  coffeeSeasons,
  coffeePriceSchedule,
  farmerIntakeEntries,
} from "../schema/coffee";
import { createJournalEntry } from "./journal";
import { recordMovement } from "./stockMovements";
import { receiveStock } from "./products";

/**
 * Coffee cooperative intake (0058).
 *
 * One posting, on every delivery:
 *
 *   DR Inventory        the coffee arrives
 *   CR Farmer Payable   the cooperative owes the farmer for it
 *
 * It went into the Mongo ledger while every ledger screen read Postgres.
 *
 * Accounts are passed in, as everywhere else on this layer: the connector owns
 * "which account is Farmer Payable for this tenant", this owns what is posted
 * to it.
 */

export type MoneyString = string;

/** The season an intake is priced against. */
export async function getActiveSeason(tx: Tx) {
  const [season] = await tx
    .select()
    .from(coffeeSeasons)
    .where(eq(coffeeSeasons.isActive, true));
  return season ?? null;
}

export async function getSeasonByName(tx: Tx, name: string) {
  const [season] = await tx
    .select()
    .from(coffeeSeasons)
    .where(eq(coffeeSeasons.name, name));
  return season ?? null;
}

/**
 * The price for a grade and type in a season.
 *
 * One row, because the unique index says so. The Mongo schedule is an embedded
 * array with nothing stopping two entries for AA parchment at different
 * prices, and the lookup takes whichever comes first.
 */
export async function findScheduledPrice(
  tx: Tx,
  seasonId: string,
  grade: string,
  coffeeType: string,
) {
  const rows = (await tx.execute(sql`
    SELECT unit_price::text AS unit_price, currency
      FROM coffee_price_schedule
     WHERE season_id = ${seasonId}::uuid
       AND upper(grade) = upper(${grade})
       AND coffee_type = ${coffeeType}::coffee_type
     LIMIT 1
  `)) as unknown as Array<{ unit_price: string; currency: string }>;
  return rows.length ? rows[0] : null;
}

export async function getIntakeByExternalRef(tx: Tx, externalRef: string) {
  const [entry] = await tx
    .select()
    .from(farmerIntakeEntries)
    .where(eq(farmerIntakeEntries.externalRef, externalRef));
  return entry ?? null;
}

export interface RecordIntakeInput {
  companyId: string;
  externalRef?: string | null;
  seasonId?: string | null;
  seasonName?: string | null;
  farmerCode: string;
  farmerName?: string | null;
  farmerPhone?: string | null;
  farmerPartyId?: string | null;
  coffeeType: "cherry" | "parchment" | "mbuni";
  grade: string;
  grossWeight: MoneyString;
  deductionWeight?: MoneyString;
  moisture?: MoneyString;
  unitPrice: MoneyString;
  currency?: string;
  productId?: string | null;
  productName?: string | null;
  collectedById?: string | null;
  collectedByName?: string | null;
  integrationKeyId?: string | null;
  notes?: string | null;
  warnings?: string[];
}

export interface IntakeAccounts {
  inventoryAccountId: string;
  farmerPayableAccountId: string;
}

/**
 * Records a delivery, moves the stock, and posts the liability.
 *
 * `net_weight` and `total_amount` are generated columns — the row is inserted
 * with the gross weight, the deduction and the price, and the two derived
 * figures come back from the database. The connector computed both in
 * JavaScript and stored them beside the inputs, so a later correction to
 * either input left them stale while the stock movement and the farmer's money
 * had already been struck from them.
 */
export async function recordIntake(
  tx: Tx,
  input: RecordIntakeInput,
  accounts: IntakeAccounts | null,
) {
  const [{ entry_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'CI') AS entry_number`,
  )) as unknown as Array<{ entry_number: string }>;

  const [entry] = await tx
    .insert(farmerIntakeEntries)
    .values({
      companyId: input.companyId,
      entryNumber: entry_number,
      externalRef: input.externalRef ?? null,
      seasonId: input.seasonId ?? null,
      seasonNameAtIntake: input.seasonName ?? null,
      farmerCode: input.farmerCode,
      farmerName: input.farmerName ?? null,
      farmerPhone: input.farmerPhone ?? null,
      farmerPartyId: input.farmerPartyId ?? null,
      coffeeType: input.coffeeType,
      grade: input.grade,
      grossWeight: input.grossWeight,
      deductionWeight: input.deductionWeight ?? "0",
      moisture: input.moisture ?? "0",
      unitPrice: input.unitPrice,
      currency: input.currency ?? "KES",
      productId: input.productId ?? null,
      productNameAtIntake: input.productName ?? null,
      collectedById: input.collectedById ?? null,
      collectedByName: input.collectedByName ?? null,
      integrationKeyId: input.integrationKeyId ?? null,
      notes: input.notes ?? null,
      warnings: input.warnings ?? [],
    })
    .returning();

  const netWeight = entry.netWeight!;
  const totalAmount = entry.totalAmount!;

  let movementId: string | null = null;
  let journalEntryId: string | null = null;

  // The coffee only reaches stock if it is a product the catalogue knows.
  if (input.productId && Number(netWeight) > 0) {
    const movement = await recordMovement(tx, {
      companyId: input.companyId,
      productId: input.productId,
      movementType: "purchase",
      direction: "in",
      quantity: netWeight,
      unitCost: input.unitPrice,
      sourceReference: entry.entryNumber,
      performedByName: input.collectedByName ?? "Coffee Coop Connector",
      affectsAccounting: true,
    });
    movementId = movement.id;

    // Record first, then move — recordMovement derives previous and new stock
    // from what the product currently holds.
    await receiveStock(tx, input.productId, netWeight, input.unitPrice);
  }

  if (accounts && Number(totalAmount) > 0) {
    const description =
      `Coffee intake — ${entry.entryNumber} · ` +
      `${input.farmerName || input.farmerCode} · ` +
      `${input.grade} ${input.coffeeType} ${netWeight}kg`;

    const je = await createJournalEntry(tx, {
      companyId: input.companyId,
      entryDate: new Date().toISOString().slice(0, 10),
      entryType: "purchase",
      description,
      reference: entry.entryNumber,
      partyType: input.farmerPartyId ? "supplier" : null,
      partyId: input.farmerPartyId ?? null,
      lines: [
        {
          accountId: accounts.inventoryAccountId,
          debit: totalAmount,
          description,
        },
        {
          accountId: accounts.farmerPayableAccountId,
          credit: totalAmount,
          description: `Owed to ${input.farmerName || input.farmerCode}`,
        },
      ],
      createdById: input.collectedById ?? null,
      postImmediately: true,
    });
    journalEntryId = je.id;
  }

  if (movementId || journalEntryId) {
    const [updated] = await tx
      .update(farmerIntakeEntries)
      .set({
        stockMovementId: movementId,
        journalEntryId,
        updatedAt: new Date(),
      })
      .where(eq(farmerIntakeEntries.id, entry.id))
      .returning();
    return updated;
  }

  return entry;
}

/** What a farmer is still owed, and what they have delivered. */
export async function getFarmerPosition(tx: Tx, farmerCode: string) {
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int                                   AS deliveries,
           COALESCE(SUM(net_weight), 0)::float8            AS total_kg,
           COALESCE(SUM(total_amount), 0)::float8          AS total_value,
           COALESCE(SUM(amount_paid), 0)::float8           AS total_paid,
           COALESCE(SUM(total_amount - amount_paid), 0)::float8 AS outstanding
      FROM farmer_intake_entries
     WHERE farmer_code = ${farmerCode} AND status = 'recorded'
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0] ?? {};
  return {
    farmerCode,
    deliveries: Number(r.deliveries ?? 0),
    totalKg: Number(r.total_kg ?? 0),
    totalValue: Number(r.total_value ?? 0),
    totalPaid: Number(r.total_paid ?? 0),
    outstanding: Number(r.outstanding ?? 0),
  };
}

export async function listIntakes(
  tx: Tx,
  opts: { seasonId?: string; farmerCode?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return tx
    .select()
    .from(farmerIntakeEntries)
    .where(
      and(
        opts.seasonId ? eq(farmerIntakeEntries.seasonId, opts.seasonId) : undefined,
        opts.farmerCode
          ? eq(farmerIntakeEntries.farmerCode, opts.farmerCode)
          : undefined,
      ),
    )
    .orderBy(desc(farmerIntakeEntries.createdAt))
    .limit(limit);
}
