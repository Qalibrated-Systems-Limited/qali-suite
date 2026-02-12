import JournalEntry from "@/app/models/JournalEntry";
import ErpCounter from "@/app/models/erp-counter";
import Company from "@/app/models/Company";






/**
 * Generate unique journal entry number using atomic counter
 *
 * Uses ErpCounter for atomic sequence generation - ERP standard approach
 * that prevents race conditions and ensures consistent numbering.
 * Automatically fetches company code from Company model for globally unique numbering.
 *
 * @param {string} prefix - Entry type prefix (SALE, BILL, EXP, PAY, REC, ADJ, REV, COGS, STK, CLOSE, etc.)
 * @param {string|ObjectId} companyId - Company ID for tenant-scoped counter (also used to fetch company code)
 * @param {Object} session - Optional MongoDB session for transactional consistency
 * @returns {Promise<string>} Entry number in format JE-{COMPANY_CODE}-{PREFIX}-{NNNN}
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
export const generateUniqueEntryNumber = async (prefix, companyId = null, session = null) => {
  // Normalize prefix to uppercase
  const normalizedPrefix = prefix.toUpperCase();

  // Fetch company code from Company model if companyId is provided
  let companyCode = null;
  if (companyId) {
    const company = await Company.findById(companyId).select("code").lean();
    companyCode = company?.code || null;
  }

  // Build counter key with company code for tenant isolation
  // Format: je-{companyCode}-{prefix} or je-{prefix} if no company code
  const counterKey = companyCode
    ? `je-${companyCode.toLowerCase()}-${normalizedPrefix.toLowerCase()}`
    : `je-${normalizedPrefix.toLowerCase()}`;

  // Build tenant filter for queries
  const tenantFilter = companyId ? { companyId } : {};

  // Build entry number prefix (with or without company code)
  // Format: JE-{COMPANY_CODE}-{PREFIX} or JE-{PREFIX}
  const entryPrefix = companyCode ? `JE-${companyCode}-${normalizedPrefix}` : `JE-${normalizedPrefix}`;

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Use atomic counter for sequence generation (tenant-scoped by companyCode in key)
      const seq = await ErpCounter.getNextSequence(counterKey, companyId, session);
      const entryNumber = `${entryPrefix}-${String(seq).padStart(4, "0")}`;

      // Verify this number doesn't already exist (handles stale counters)
      let existsQuery = JournalEntry.exists({ ...tenantFilter, entryNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;
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

      // Escape special regex characters in entryPrefix
      const escapedPrefix = entryPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let findQuery = JournalEntry.findOne(
        { ...tenantFilter, entryNumber: new RegExp(`^${escapedPrefix}-\\d+$`) }
      )
        .sort({ entryNumber: -1 })
        .limit(1)
        .lean();
      if (session) findQuery = findQuery.session(session);
      const lastEntry = await findQuery;

      let nextNum = 1;
      if (lastEntry?.entryNumber) {
        const match = lastEntry.entryNumber.match(/(\d+)$/);
        if (match) {
          nextNum = parseInt(match[1], 10) + 1;
        }
      }

      const entryNumber = `${entryPrefix}-${String(nextNum).padStart(4, "0")}`;

      let existsQuery = JournalEntry.exists({ ...tenantFilter, entryNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;
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
  return `${entryPrefix}-${timestamp}-${random}`;
};
