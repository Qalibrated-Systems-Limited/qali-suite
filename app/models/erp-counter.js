import mongoose from "mongoose";

const Schema = mongoose.Schema;

const counterSchema = new Schema({
  _id: String, // e.g., "companyId-bill-202501", "companyId-je-bill"
  seq: { type: Number, default: 0 },
});

/**
 * Get next sequence for a tenant-scoped counter
 * @param {string} name - Counter name (e.g., "bill-202501", "je-bill")
 * @param {string|ObjectId} companyId - Company ID for tenant scoping
 * @param {ClientSession} session - Optional MongoDB session for transactions
 * @returns {number} Next sequence number
 */
counterSchema.statics.getNextSequence = async function (name, companyId = null, session = null) {
  const options = session ? { session } : {};

  // Build tenant-scoped counter ID
  const counterId = companyId ? `${companyId}-${name}` : name;

  // First, check if counter exists
  const existingCounter = await this.findById(counterId, null, options);

  if (!existingCounter) {
    // Counter doesn't exist - initialize from existing data
    let maxSeq = 0;

    // Build tenant filter for queries
    const tenantFilter = companyId ? { companyId } : {};

    // Check for journal entry counters (je-*)
    if (name.startsWith("je-")) {
      const prefix = name.replace("je-", "").toUpperCase();
      const JournalEntry = mongoose.model("JournalEntry");

      // Find highest existing entry number for this prefix
      const lastEntry = await JournalEntry.findOne(
        { ...tenantFilter, entryNumber: new RegExp(`^JE-${prefix}-\\d+$`) },
        null,
        options
      )
        .sort({ entryNumber: -1 })
        .limit(1)
        .lean();

      if (lastEntry?.entryNumber) {
        const match = lastEntry.entryNumber.match(/(\d+)$/);
        if (match) {
          maxSeq = parseInt(match[1], 10);
        }
      }
    }

    // Check for bill counters (bill-*)
    if (name.startsWith("bill-")) {
      const Bill = mongoose.model("Bill");
      const lastBill = await Bill.findOne(tenantFilter, null, options)
        .sort({ billNumber: -1 })
        .limit(1)
        .lean();

      if (lastBill?.billNumber) {
        const match = lastBill.billNumber.match(/(\d+)$/);
        if (match) {
          maxSeq = parseInt(match[1], 10);
        }
      }
    }

    // Check for payment counters (payment-pay-rec-YYYYMM or payment-pay-made-YYYYMM)
    if (name.startsWith("payment-")) {
      const Payment = mongoose.model("Payment");
      // Extract the pattern from counter name: payment-pay-rec-202501 -> PAY-REC-202501
      const patternPart = name.replace("payment-", "").toUpperCase();

      const lastPayment = await Payment.findOne(
        { ...tenantFilter, paymentNumber: new RegExp(`^${patternPart}-\\d+$`) },
        null,
        options
      )
        .sort({ paymentNumber: -1 })
        .limit(1)
        .lean();

      if (lastPayment?.paymentNumber) {
        const match = lastPayment.paymentNumber.match(/(\d+)$/);
        if (match) {
          maxSeq = parseInt(match[1], 10);
        }
      }
    }

    // Create counter with initial value (maxSeq + 1)
    // Using create instead of findByIdAndUpdate to avoid $setOnInsert/$inc conflict
    try {
      await this.create([{ _id: counterId, seq: maxSeq + 1 }], options);
      return maxSeq + 1;
    } catch (createError) {
      // Handle race condition - counter may have been created by another request
      if (createError.code === 11000) {
        // Duplicate key - counter was just created, increment it
        const counter = await this.findByIdAndUpdate(
          counterId,
          { $inc: { seq: 1 } },
          { new: true, ...options }
        );
        return counter.seq;
      }
      throw createError;
    }
  }

  // Counter exists - just increment
  const counter = await this.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { new: true, ...options }
  );
  return counter.seq;
};

const models = mongoose.models;
let ErpCounter = models?.ErpCounter;

if (!ErpCounter) {
  ErpCounter = mongoose.model("ErpCounter", counterSchema);
}

export default ErpCounter;
export { ErpCounter };
