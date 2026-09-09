import { withTenant } from "@/app/db/client";
import {
  findProcessedByExternalRef,
  createSyncLog,
  markSyncLogProcessed,
  markSyncLogFailed,
} from "@/app/db/repositories/integrations";

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

/**
 * On Postgres since 0102.
 *
 * ── THE LOG IS NOT IN THE SUBCLASS'S TRANSACTION, DELIBERATELY ────────────
 *
 * `execute()` opens its own `withTenant` transaction — that is where the
 * ticket, the movement and the journal entry are written together, and it must
 * stay that way. The log rows around it are separate short transactions.
 *
 * The consequence is worth being explicit about: if the process dies between
 * `execute()` committing and the log being marked processed, the work is done
 * and the log still says 'processing'. That is the SAFE direction of the two —
 * the idempotency read only treats 'processed' as a hit, so the gate's retry
 * re-executes rather than silently returning a cached success for work that
 * may not have happened. The other direction, marking the log first, would
 * hand back a fabricated result.
 *
 * The partial unique index on (company_id, external_ref) for inbound rows in
 * 'processed' or 'processing' is what stops that retry from racing the
 * original: the second one is a 23505, which apiTenant.ts renders as a 409.
 * Mongo indexes external_ref without uniqueness, so both proceed and the gate
 * gets two tickets for one trip.
 */
export class BaseConnector {
  /**
   * @param {string} companyId  - Tenant ID (the company's POSTGRES uuid)
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
    // ── 1. Idempotency check ──────────────────────────────
    if (externalRef) {
      const existing = await withTenant(this.companyId, (tx) =>
        findProcessedByExternalRef(tx, externalRef),
      );

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
    const logEntry = await withTenant(this.companyId, (tx) =>
      createSyncLog(tx, this.companyId, {
        direction: "inbound",
        event: this.event,
        status: "processing",
        connectorType: this.connectorType || null,
        integrationKeyId: this.keyId || null,
        externalRef: externalRef || null,
        rawPayload: payload,
      }),
    );

    let mapped;
    try {
      // ── 3. Validate ──────────────────────────────────────
      const validated = await this.validate(payload);

      // ── 4. Map ───────────────────────────────────────────
      mapped = await this.map(validated);

      // ── 5. Execute ───────────────────────────────────────
      const result = await this.execute(mapped);

      // ── 6. Mark processed ────────────────────────────────
      await withTenant(this.companyId, (tx) =>
        markSyncLogProcessed(tx, logEntry.id, {
          internalRef: result.internalRef || null,
          /**
           * `internal_id` is a uuid column. The Mongo model typed it ObjectId
           * and connectors set it from whatever `execute()` returned, so a
           * result carrying a document NUMBER rather than an id stored a
           * CastError-in-waiting. Anything that is not a uuid is dropped here
           * rather than failing the write of an operation that has already
           * committed — `internal_ref` is the human-facing pointer and is
           * always kept.
           */
          internalId: isUuid(result.internalId) ? result.internalId : null,
          mappedPayload: mapped,
          result,
        }),
      );

      return { cached: false, ...result };
    } catch (err) {
      // ── 7. Mark failed ───────────────────────────────────
      /**
       * In its own try: the log write must not replace the error that caused
       * it. Mongo's `await logEntry.save()` here throws over the top of the
       * real failure, so the gate is told about a database write it has never
       * heard of instead of about its own malformed payload.
       *
       * Marking it 'failed' also releases the partial unique index, which is
       * what lets the sender legitimately retry the same externalRef.
       */
      try {
        await withTenant(this.companyId, (tx) =>
          markSyncLogFailed(tx, logEntry.id, err.message || String(err)),
        );
      } catch (logErr) {
        console.error("[connector] could not record failure:", logErr);
      }

      throw err; // Re-throw so the route handler returns the right HTTP error
    }
  }

  // ── Utility helpers available to all subclasses ─────────

  /**
   * Check companyId ownership on a document.
   *
   * Vestigial, and kept only so subclasses that call it still work: under RLS
   * a row from another tenant is not returned at all, so there is nothing left
   * for this to catch. `assertTenant(null)` is still the useful half.
   */
  assertTenant(document) {
    if (!document) throw new Error("Document not found");
    const docCompany = document.companyId?.toString();
    if (docCompany && docCompany !== this.companyId.toString()) {
      throw new Error("Tenant mismatch — access denied");
    }
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}
