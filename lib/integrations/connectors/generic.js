import { BaseConnector } from "./base.js";

// ============================================
// GENERIC CONNECTOR
// Passthrough connector — validates that the payload
// is a non-empty object and stores it in the sync log.
// Used for keys with connectorType: "generic" or
// as a fallback while vertical connectors are built.
// ============================================

export class GenericConnector extends BaseConnector {
  async validate(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Payload must be a non-empty JSON object");
    }
    return payload;
  }

  async map(validated) {
    // Passthrough — no transformation
    return validated;
  }

  async execute(mapped) {
    // Generic connector just logs — no ERP action taken
    return {
      internalRef: null,
      internalId: null,
      message: "Payload received and logged. No ERP action taken by generic connector.",
    };
  }
}
