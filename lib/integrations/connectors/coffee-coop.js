import { BaseConnector } from "./base.js";
import { withTenant } from "@/app/db/client";
import {
  getActiveSeason,
  getSeasonByName,
  findScheduledPrice,
  getIntakeByExternalRef,
  recordIntake,
} from "@/app/db/repositories/coffee";
import { findProductByCodeOrName } from "@/app/db/repositories/products";
import { getSystemAccount } from "@/app/db/repositories/accounts";
import { coffeeTypeEnum } from "@/app/db/schema/enums";
import { emitWebhookEvent } from "../webhooks/emitter.js";

// The valid coffee types come from the POSTGRES enum, which is what the column
// is constrained by — reading them off the Mongo model let the connector
// accept a value the database would then refuse.
const COFFEE_TYPES = coffeeTypeEnum.enumValues;

// Kenyan coffee grades. A `text` column rather than an enum, because a
// cooperative may grade to its own scale — so this is the station-facing
// validation list, not a database constraint.
const COFFEE_GRADES = ["AA", "AB", "C", "PB", "E", "TT", "T", "UG", "MH", "ML"];

// ============================================
// COFFEE COOP CONNECTOR
//
// Handles intake station events from a
// cooperative collection centre.
//
// Single event:
//   "collection.intake_created" — farmer arrives
//     with coffee; station weighs and grades it.
//
// GL posted on every intake:
//   DR Inventory      (coffee stock increases)
//   CR Farmer Payable (liability to the farmer)
//
// Payment clearing is handled separately:
//   DR Farmer Payable / CR Cash | Bank | Mpesa
//
// PRICING:
//   unitPrice can be sent in the payload (station
//   software set the price) OR resolved from the
//   active season's priceSchedule by grade +
//   coffeeType.  If neither is available, intake is
//   recorded but GL is skipped with a warning.
// ============================================

export class CoffeeCoopConnector extends BaseConnector {
  constructor(companyId, keyId) {
    super(companyId, keyId, "coffee_coop");
    this.connectorType = "coffee_coop";
  }

  // ── validate ──────────────────────────────────────────────

  async validate(payload) {
    const { event } = payload;

    if (event !== "collection.intake_created") {
      throw new Error(
        `Unknown event: "${event}". Expected "collection.intake_created".`
      );
    }

    if (!payload.farmerCode?.toString().trim()) {
      throw new Error("farmerCode is required — the farmer's cooperative member number");
    }

    if (!payload.coffeeType) {
      throw new Error(`coffeeType is required. Valid values: ${COFFEE_TYPES.join(", ")}`);
    }
    if (!COFFEE_TYPES.includes(payload.coffeeType)) {
      throw new Error(`Invalid coffeeType: "${payload.coffeeType}". Valid: ${COFFEE_TYPES.join(", ")}`);
    }

    if (!payload.grade) {
      throw new Error(`grade is required. Valid values: ${COFFEE_GRADES.join(", ")}`);
    }
    if (!COFFEE_GRADES.includes(payload.grade)) {
      throw new Error(`Invalid grade: "${payload.grade}". Valid: ${COFFEE_GRADES.join(", ")}`);
    }

    const grossWeight = Number(payload.grossWeight);
    if (!grossWeight || grossWeight <= 0) {
      throw new Error("grossWeight must be a positive number in kg");
    }

    const deductionWeight = Number(payload.deductionWeight ?? 0);
    if (deductionWeight < 0) {
      throw new Error("deductionWeight cannot be negative");
    }
    if (deductionWeight >= grossWeight) {
      throw new Error("deductionWeight cannot be greater than or equal to grossWeight");
    }

    const netWeight = Math.round((grossWeight - deductionWeight) * 1000) / 1000;

    return {
      ...payload,
      farmerCode:      payload.farmerCode.toString().trim(),
      farmerName:      payload.farmerName?.toString().trim()  || "",
      farmerPhone:     payload.farmerPhone?.toString().trim() || "",
      coffeeType:      payload.coffeeType,
      grade:           payload.grade,
      grossWeight,
      moisture:        Number(payload.moisture ?? 0),
      deductionWeight,
      netWeight,
      productCode:     payload.productCode?.toString().trim() || null,
      seasonRef:       payload.seasonRef?.toString().trim()   || null,
      notes:           payload.notes?.toString().trim()       || "",
      // unitPrice may be undefined — resolved in map()
      unitPrice:       payload.unitPrice != null ? Number(payload.unitPrice) : null,
    };
  }

  // ── map ────────────────────────────────────────────────────

  async map(validated) {
    const result = { ...validated };

    // Season, price and product all come from POSTGRES now, in one
    // transaction so the three reads see the same snapshot.
    await withTenant(this.companyId, async (tx) => {
      const season = validated.seasonRef
        ? await getSeasonByName(tx, validated.seasonRef)
        : await getActiveSeason(tx);

      if (season) {
        result.seasonId = season.id;
        result.seasonName = season.name;
        result.defaultProductId = season.defaultProductId ?? null;

        // The schedule has ONE row per grade per type per season — a unique
        // index says so. The Mongo schedule is an embedded array with nothing
        // stopping two entries for AA parchment at different prices, and the
        // find() takes whichever comes first.
        if (result.unitPrice == null) {
          const scheduled = await findScheduledPrice(
            tx,
            season.id,
            validated.grade,
            validated.coffeeType,
          );
          if (scheduled) result.unitPrice = Number(scheduled.unit_price);
        }
      }

      // Explicit productCode wins; the season's default is the fallback.
      let product = null;
      if (validated.productCode) {
        product = await findProductByCodeOrName(tx, validated.productCode);
      }
      if (!product && result.defaultProductId) {
        const rows = await tx.execute(
          (await import("drizzle-orm")).sql`
            SELECT id, name, sku, unit FROM products
             WHERE id = ${result.defaultProductId}::uuid`,
        );
        if (rows.length) {
          product = {
            id: String(rows[0].id),
            name: String(rows[0].name),
            sku: rows[0].sku ?? null,
            unit: rows[0].unit ?? null,
          };
        }
      }
      if (product) {
        result.productId = product.id;
        result.productName = product.name;
        result.productSnapshot = {
          name: product.name,
          SKU: product.sku,
          unit: product.unit,
        };
      }
    });

    // `totalAmount` is NOT computed here any more. It is a generated column —
    // round(net × unitPrice, 4) — so the figure the ledger is struck from is
    // the database's, not this connector's, and a later correction to the
    // weight or the price cannot leave it behind.
    return result;
  }

  // ── execute ────────────────────────────────────────────────

  async execute(mapped) {
    if (!mapped.seasonId) {
      throw new Error(
        "No active coffee season found. Create a season in the Coffee Coop settings " +
        "or pass seasonRef in the payload."
      );
    }

    const warnings = [];

    if (mapped.unitPrice == null) {
      warnings.push(
        `No price for ${mapped.grade} ${mapped.coffeeType} in season ` +
        `${mapped.seasonName} and none sent — the delivery is recorded at zero ` +
        `and nothing is posted. Add it to the season's price schedule, then post manually.`,
      );
    }
    if (!mapped.productId) {
      warnings.push(
        mapped.productCode
          ? `productCode "${mapped.productCode}" not found in the catalogue — ` +
            `stock movement skipped.`
          : `No product for this intake and the season has no default — ` +
            `stock movement skipped.`,
      );
    }

    const entry = await withTenant(this.companyId, async (tx) => {
      // The station's reference is an idempotency key. A retried call finds
      // the delivery it already recorded rather than recording it twice — the
      // unique index would refuse the insert anyway, but saying so plainly is
      // better than a constraint name.
      if (mapped.externalRef) {
        const existing = await getIntakeByExternalRef(tx, mapped.externalRef);
        if (existing) {
          throw new Error(
            `Intake ${existing.entryNumber} has already been recorded for ` +
            `reference "${mapped.externalRef}".`,
          );
        }
      }

      // DR Inventory / CR Farmer Payable, into the ledger the screens read.
      let accounts = null;
      const [inventory, farmerPayable] = await Promise.all([
        getSystemAccount(tx, "inventory"),
        getSystemAccount(tx, "farmer_payable"),
      ]);
      if (!inventory) {
        warnings.push("Inventory account not configured — GL entry skipped.");
      } else if (!farmerPayable) {
        warnings.push(
          "Farmer Payable account not configured — GL entry skipped. " +
          "Add an account with system type 'farmer_payable'.",
        );
      } else {
        accounts = {
          inventoryAccountId: inventory.id,
          farmerPayableAccountId: farmerPayable.id,
        };
      }

      return recordIntake(
        tx,
        {
          companyId: this.companyId,
          externalRef: mapped.externalRef ?? null,
          seasonId: mapped.seasonId,
          seasonName: mapped.seasonName || null,
          farmerCode: mapped.farmerCode,
          farmerName: mapped.farmerName || null,
          farmerPhone: mapped.farmerPhone || null,
          coffeeType: mapped.coffeeType,
          grade: mapped.grade,
          grossWeight: String(mapped.grossWeight),
          deductionWeight: String(mapped.deductionWeight ?? 0),
          moisture: String(mapped.moisture ?? 0),
          unitPrice: String(mapped.unitPrice ?? 0),
          currency: mapped.currency || "KES",
          productId: mapped.productId ?? null,
          productName: mapped.productName ?? null,
          collectedByName: mapped.collectedBy?.name ?? "Intake Station",
          integrationKeyId: this.keyId || null,
          notes: mapped.notes || null,
          warnings,
        },
        accounts,
      );
    });

    emitWebhookEvent({
      companyId: this.companyId,
      event: "collection.intake_recorded",
      payload: {
        intakeId: entry.id,
        entryNumber: entry.entryNumber,
        externalRef: mapped.externalRef ?? null,
        farmerCode: entry.farmerCode,
        farmerName: entry.farmerName,
        coffeeType: entry.coffeeType,
        grade: entry.grade,
        grossWeight: Number(entry.grossWeight),
        deductionWeight: Number(entry.deductionWeight),
        netWeight: Number(entry.netWeight),
        unitPrice: Number(entry.unitPrice),
        totalAmount: Number(entry.totalAmount),
        seasonName: entry.seasonNameAtIntake,
        warnings,
      },
      connectorType: "coffee_coop",
    });

    return {
      internalRef: entry.entryNumber,
      internalId: entry.id,
      intakeId: entry.id,
      entryNumber: entry.entryNumber,
      farmerCode: entry.farmerCode,
      grade: entry.grade,
      coffeeType: entry.coffeeType,
      // Both derived by the database, not by this connector.
      netWeight: Number(entry.netWeight),
      unitPrice: Number(entry.unitPrice),
      totalAmount: Number(entry.totalAmount),
      currency: entry.currency,
      journalEntryId: entry.journalEntryId,
      stockMovementId: entry.stockMovementId,
      warnings,
      message:
        `Intake ${entry.entryNumber} recorded — ${entry.farmerName || entry.farmerCode}, ` +
        `${entry.netWeight}kg ${entry.grade} ${entry.coffeeType} ` +
        `at ${entry.unitPrice}/kg = ${entry.totalAmount} ${entry.currency}.` +
        (warnings.length ? ` Warnings: ${warnings.length}` : ""),
    };
  }

}

// The Mongo stock, GL and counter helpers that used to follow are gone. The
// posting is `recordIntake` in app/db/repositories/coffee.ts, and the numbers
// come from `next_entry_number` — an atomic per-company sequence rather than a
// global `Counter` document that every tenant shared. `generateIntakeNumber`
// in particular was keyed on the literal string "intake_entry", so two
// cooperatives on this install drew from the same run of numbers.
