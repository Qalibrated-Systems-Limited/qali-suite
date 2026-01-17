import JournalEntry from "@/app/models/JournalEntry";
import ErpCounter from "@/app/models/erp-counter";

/**
 * Generate unique journal entry number using atomic counter
 *
 * Uses ErpCounter for atomic sequence generation - ERP standard approach
 * that prevents race conditions and ensures consistent numbering.
 *
 * @param {string} prefix - Entry type prefix (SALE, BILL, EXP, PAY, REC, ADJ, REV, COGS, STK, CLOSE, etc.)
 * @param {Object} session - Optional MongoDB session for transactional consistency
 * @returns {Promise<string>} Entry number in format JE-{PREFIX}-{NNNN}
 *
 * Prefixes:
 * - SALE: Invoice/Sale revenue entries
 * - COGS: Cost of goods sold entries
 * - BILL: Supplier bill entries
 * - EXP: Expense entries
 * - PAY: Payment made entries
 * - REC: Payment received entries
 * - ADV: Employee advance entries
 * - ADJ: Adjustment entries (inventory, etc.)
 * - REV: Reversal entries
 * - STK: Stock movement entries
 * - CLOSE: Period closing entries
 */
export const generateUniqueEntryNumber = async (prefix, session = null) => {
  // Normalize prefix to uppercase
  const normalizedPrefix = prefix.toUpperCase();
  const counterKey = `je-${normalizedPrefix.toLowerCase()}`;
  const queryOptions = session ? { session } : {};

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Use atomic counter for sequence generation
      const seq = await ErpCounter.getNextSequence(counterKey, session);
      const entryNumber = `JE-${normalizedPrefix}-${String(seq).padStart(4, "0")}`;

      // Verify this number doesn't already exist (handles stale counters)
      const exists = await JournalEntry.exists({ entryNumber, ...queryOptions });
      if (!exists) {
        return entryNumber;
      }

      // Number exists - counter was stale, try again (counter will increment)
      console.warn(`JE number ${entryNumber} already exists, retrying...`);
      continue;
    } catch (counterError) {
      // Counter failed - use query-based fallback for this attempt
      console.warn(
        `Counter failed for ${counterKey}, attempt ${attempt + 1}:`,
        counterError.message
      );

      const lastEntry = await JournalEntry.findOne(
        { entryNumber: new RegExp(`^JE-${normalizedPrefix}-\\d+$`) },
        null,
        queryOptions
      )
        .sort({ entryNumber: -1 })
        .limit(1)
        .lean();

      let nextNum = 1;
      if (lastEntry?.entryNumber) {
        const match = lastEntry.entryNumber.match(/(\d+)$/);
        if (match) {
          nextNum = parseInt(match[1], 10) + 1;
        }
      }

      const entryNumber = `JE-${normalizedPrefix}-${String(nextNum).padStart(4, "0")}`;

      const exists = await JournalEntry.exists({ entryNumber, ...queryOptions });
      if (!exists) {
        return entryNumber;
      }
    }

    // Exponential backoff before retry
    await new Promise((resolve) =>
      setTimeout(resolve, 50 * Math.pow(2, attempt))
    );
  }

  // Ultimate fallback with timestamp - guaranteed unique
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `JE-${normalizedPrefix}-${timestamp}-${random}`;
};
