import { BaseConnector } from "./base.js";
import CoffeeSeason from "@/app/models/coffeeSeason.js";
import FarmerIntakeEntry, { COFFEE_TYPES, COFFEE_GRADES } from "@/app/models/farmerIntakeEntry.js";
import Product from "@/app/models/product.js";
import Account from "@/app/models/account.js";
import JournalEntry from "@/app/models/JournalEntry.js";
import { StockMovement } from "@/app/models/stockmovement.js";
import Counter from "@/app/models/counter.js";
import { emitWebhookEvent } from "../webhooks/emitter.js";

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

    // ── Resolve season ────────────────────────────────────────
    let season = null;

    if (validated.seasonRef) {
      season = await CoffeeSeason.findOne({
        companyId: this.companyId,
        $or: [
          { name: validated.seasonRef },
          { _id: validated.seasonRef.match(/^[0-9a-fA-F]{24}$/) ? validated.seasonRef : null },
        ],
      }).lean();
    }

    if (!season) {
      // Fall back to the active season
      season = await CoffeeSeason.findOne({
        companyId: this.companyId,
        isActive: true,
      }).lean();
    }

    if (season) {
      result.seasonId   = season._id;
      result.seasonName = season.name;
      result.defaultProductId = season.defaultProductId ?? null;

      // Resolve price from season schedule if not supplied in payload
      if (result.unitPrice == null) {
        const scheduleEntry = season.priceSchedule?.find(
          (p) => p.grade === validated.grade && p.coffeeType === validated.coffeeType
        );
        if (scheduleEntry) {
          result.unitPrice = scheduleEntry.unitPrice;
        }
      }
    }

    // ── Resolve product ────────────────────────────────────────
    // Priority: explicit productCode → season defaultProductId
    let product = null;

    if (validated.productCode) {
      product = await Product.findOne({
        companyId: this.companyId,
        $or: [
          { SKU: validated.productCode },
          { name: { $regex: new RegExp(`^${validated.productCode}$`, "i") } },
        ],
      }).lean();
    }

    if (!product && result.defaultProductId) {
      product = await Product.findOne({
        companyId: this.companyId,
        _id: result.defaultProductId,
      }).lean();
    }

    if (product) {
      result.productId       = product._id;
      result.productName     = product.name;
      result.productSnapshot = { name: product.name, SKU: product.SKU, unit: product.unit };
    }

    // ── Calculate total ────────────────────────────────────────
    if (result.unitPrice != null) {
      result.totalAmount = Math.round(result.netWeight * result.unitPrice * 100) / 100;
    } else {
      result.totalAmount = 0;
    }

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

    // ── 1. Auto-number ─────────────────────────────────────────
    const entryNumber = await generateIntakeNumber();

    // ── 2. Determine payment method ────────────────────────────
    const paymentMethod = mapped.paymentMethod || "member_account";

    // ── 3. Create FarmerIntakeEntry ────────────────────────────
    const entry = await FarmerIntakeEntry.create({
      companyId:       this.companyId,
      entryNumber,
      externalRef:     mapped.externalRef ?? null,
      seasonId:        mapped.seasonId,
      seasonName:      mapped.seasonName || "",
      farmerCode:      mapped.farmerCode,
      farmerName:      mapped.farmerName,
      farmerPhone:     mapped.farmerPhone,
      coffeeType:      mapped.coffeeType,
      grade:           mapped.grade,
      grossWeight:     mapped.grossWeight,
      moisture:        mapped.moisture,
      deductionWeight: mapped.deductionWeight,
      netWeight:       mapped.netWeight,
      unitPrice:       mapped.unitPrice ?? 0,
      currency:        mapped.currency || "KES",
      totalAmount:     mapped.totalAmount,
      paymentMethod,
      paymentStatus:   "pending",
      productId:       mapped.productId ?? null,
      productSnapshot: mapped.productSnapshot ?? null,
      status:          "received",
      collectedBy:     mapped.collectedBy ?? { id: "system", name: "Intake Station" },
      notes:           mapped.notes,
    });

    // ── 4. Stock movement (only when product is known) ─────────
    let stockMovementId = null;

    if (mapped.productId) {
      try {
        const product = await Product.findById(mapped.productId);
        if (product) {
          const prevQty = product.inventory?.quantityOnHand ?? 0;
          const movementNumber = await StockMovement.generateMovementNumber(this.companyId);

          const movement = await StockMovement.create({
            companyId: this.companyId,
            movementNumber,
            productId: mapped.productId,
            productSnapshot: mapped.productSnapshot,
            movementType: "purchase",
            direction: "in",
            quantity: mapped.netWeight,
            previousStock: prevQty,
            newStock: prevQty + mapped.netWeight,
            costing: {
              unitCost:  mapped.unitPrice ?? 0,
              totalCost: mapped.totalAmount,
            },
            performedBy: { name: "Intake Station", id: "system", role: "system" },
            notes: `Coffee intake ${entryNumber} — ${mapped.farmerName || mapped.farmerCode} · ${mapped.grade} ${mapped.coffeeType}`,
            status: "posted",
            postedAt: new Date(),
            postedBy: { name: "Coffee Coop Connector", id: "system" },
          });

          // Update product inventory
          await Product.findByIdAndUpdate(mapped.productId, {
            $inc: {
              "inventory.quantityOnHand":  mapped.netWeight,
              "inventory.quantityAvailable": mapped.netWeight,
            },
          });

          stockMovementId = movement._id;

          // Link movement back to entry
          await FarmerIntakeEntry.findByIdAndUpdate(entry._id, {
            stockMovementId: movement._id,
          });
        }
      } catch (err) {
        warnings.push(`Stock movement skipped: ${err.message}`);
      }
    } else {
      warnings.push("No product linked — stock movement skipped. Set defaultProductId on the season or pass productCode.");
    }

    // ── 5. Journal entry: DR Inventory / CR Farmer Payable ─────
    let journalEntryId     = null;
    let journalEntryNumber = null;

    if (mapped.totalAmount > 0) {
      const jeResult = await _createJournalEntry(this.companyId, mapped, entry, entryNumber);
      if (jeResult.warning) {
        warnings.push(jeResult.warning);
      } else {
        journalEntryId     = jeResult.journalEntryId;
        journalEntryNumber = jeResult.journalEntryNumber;

        await FarmerIntakeEntry.findByIdAndUpdate(entry._id, {
          journalEntryId,
          journalEntryNumber,
          status: "processed",
        });
      }
    } else {
      warnings.push("No unit price available — GL entry skipped. Set a price schedule on the season or pass unitPrice.");
    }

    // Persist warnings
    if (warnings.length > 0) {
      await FarmerIntakeEntry.findByIdAndUpdate(entry._id, { warnings });
    }

    // ── 6. Emit webhook ────────────────────────────────────────
    emitWebhookEvent({
      companyId:     this.companyId,
      event:         "collection.intake_created",
      payload: {
        entryNumber,
        farmerCode:   mapped.farmerCode,
        farmerName:   mapped.farmerName,
        grade:        mapped.grade,
        coffeeType:   mapped.coffeeType,
        netWeight:    mapped.netWeight,
        unitPrice:    mapped.unitPrice,
        totalAmount:  mapped.totalAmount,
        seasonName:   mapped.seasonName,
        paymentMethod,
      },
      connectorType: "coffee_coop",
    });

    return {
      internalRef:       entryNumber,
      internalId:        entry._id,
      entryNumber,
      farmerCode:        mapped.farmerCode,
      grade:             mapped.grade,
      coffeeType:        mapped.coffeeType,
      netWeight:         mapped.netWeight,
      totalAmount:       mapped.totalAmount,
      journalEntryNumber,
      stockMovementId:   stockMovementId?.toString() ?? null,
      warnings,
    };
  }
}

// ── Journal entry helper ───────────────────────────────────

async function _createJournalEntry(companyId, mapped, entry, entryNumber) {
  const [inventoryAcc, farmerPayableAcc] = await Promise.all([
    Account.findOne({ companyId, systemAccount: "inventory"       }).lean(),
    Account.findOne({ companyId, systemAccount: "farmer_payable"  }).lean(),
  ]);

  if (!inventoryAcc) {
    return { warning: "Inventory account not configured — GL entry skipped" };
  }
  if (!farmerPayableAcc) {
    return { warning: "Farmer Payable account not configured — GL entry skipped. Add an account with system type 'farmer_payable'." };
  }

  const amount = mapped.totalAmount;
  const jeNumber = await generateJournalEntryNumber(companyId);

  const je = await JournalEntry.create({
    companyId,
    entryNumber: jeNumber,
    entryDate:   new Date(),
    entryType:   "purchase",
    description: `Coffee intake — ${entryNumber} · ${mapped.farmerName || mapped.farmerCode} · ${mapped.grade} ${mapped.coffeeType} ${mapped.netWeight}kg`,
    lines: [
      {
        // DR Inventory — coffee stock increases
        accountId:   inventoryAcc._id,
        accountCode: inventoryAcc.accountCode,
        accountName: inventoryAcc.accountName,
        accountType: inventoryAcc.accountType,
        debit:       amount,
        credit:      0,
        description: `Coffee intake ${entryNumber} — ${mapped.grade} ${mapped.coffeeType} ${mapped.netWeight}kg`,
      },
      {
        // CR Farmer Payable — liability to farmer
        accountId:   farmerPayableAcc._id,
        accountCode: farmerPayableAcc.accountCode,
        accountName: farmerPayableAcc.accountName,
        accountType: farmerPayableAcc.accountType,
        debit:       0,
        credit:      amount,
        description: `Due to farmer ${mapped.farmerCode} — ${mapped.farmerName || ""}`,
      },
    ],
    relatedDocuments: {
      // No built-in ref type for intake entries — store as notes
    },
    status:    "draft",
    createdBy: { id: "system", name: "Coffee Coop Connector" },
  });

  // Post immediately
  await je.post({ id: "system", name: "Coffee Coop Connector" });

  return { journalEntryId: je._id, journalEntryNumber: jeNumber };
}

// ── Sequence helpers ───────────────────────────────────────

async function generateIntakeNumber() {
  const counter = await Counter.findOneAndUpdate(
    { name: "intake_entry" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `INTAKE-${String(counter.seq).padStart(6, "0")}`;
}

async function generateJournalEntryNumber(companyId) {
  const counterId = `je_intake_${companyId}`;
  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `JE-INT-${String(counter.seq).padStart(6, "0")}`;
}
