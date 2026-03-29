import dbConnect from "@/app/config/dbConnect";
import SyncLog from "@/app/models/syncLog.js";

// ============================================
// BASE CONNECTOR
// Every vertical connector extends this class.
// Orchestrates: idempotency → validate → map → execute → log
//
// Subclasses must implement:
//   async validate(payload)  → validatedPayload or throw
//   async map(validated)     → mappedPayload
//   async execute(mapped)    → { internalRef, internalId, ...result }
// ============================================

export class BaseConnector {
  /**
   * @param {string} companyId  - Tenant ID
   * @param {string} keyId      - Integration key ID (for log attribution)
   * @param {string} event      - Event name e.g. "weighbridge.ticket_completed"
   */
  constructor(companyId, keyId, event) {
    this.companyId = companyId;
    this.keyId = keyId;
    this.event = event;
  }

  // ── Subclasses override these ───────────────────────────

  async validate(payload) {
    throw new Error(`${this.constructor.name} must implement validate()`);
  }

  async map(validatedPayload) {
    throw new Error(`${this.constructor.name} must implement map()`);
  }

  async execute(mappedPayload) {
    throw new Error(`${this.constructor.name} must implement execute()`);
  }

  // ── Orchestrator — called by route handlers ─────────────

  /**
   * Process an inbound payload end-to-end.
   * @param {object} payload      - Raw payload from external system
   * @param {string} externalRef  - Sender's unique ID for this event
   * @returns {{ cached, internalRef, internalId, ...result }}
   */
  async process(payload, externalRef) {
    await dbConnect();

    // ── 1. Idempotency check ──────────────────────────────
    if (externalRef) {
      const existing = await SyncLog.findOne({
        companyId: this.companyId,
        externalRef,
        status: "processed",
      }).lean();

      if (existing) {
        return {
          cached: true,
          internalRef: existing.internalRef,
          internalId: existing.internalId,
          result: existing.result,
        };
      }
    }

    // ── 2. Create pending log entry ───────────────────────
    const logEntry = await SyncLog.create({
      companyId: this.companyId,
      integrationKeyId: this.keyId || null,
      direction: "inbound",
      event: this.event,
      connectorType: this.connectorType || null,
      externalRef: externalRef || null,
      rawPayload: payload,
      status: "processing",
    });

    try {
      // ── 3. Validate ──────────────────────────────────────
      const validated = await this.validate(payload);

      // ── 4. Map ───────────────────────────────────────────
      const mapped = await this.map(validated);

      // Update log with mapped payload
      logEntry.mappedPayload = mapped;

      // ── 5. Execute ───────────────────────────────────────
      const result = await this.execute(mapped);

      // ── 6. Mark processed ────────────────────────────────
      logEntry.status = "processed";
      logEntry.internalRef = result.internalRef || null;
      logEntry.internalId = result.internalId || null;
      logEntry.result = result;
      logEntry.processedAt = new Date();
      await logEntry.save();

      return { cached: false, ...result };

    } catch (err) {
      // ── 7. Mark failed ───────────────────────────────────
      logEntry.status = "failed";
      logEntry.error = err.message || String(err);
      await logEntry.save();

      throw err; // Re-throw so the route handler returns the right HTTP error
    }
  }

  // ── Utility helpers available to all subclasses ─────────

  /**
   * Check companyId ownership on a document.
   * Prevents connectors from accidentally touching another tenant's data.
   */
  assertTenant(document) {
    if (!document) throw new Error("Document not found");
    const docCompany = document.companyId?.toString();
    if (docCompany && docCompany !== this.companyId.toString()) {
      throw new Error("Tenant mismatch — access denied");
    }
  }
}
