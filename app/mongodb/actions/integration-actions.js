"use server";

import crypto from "crypto";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { planIncludes } from "@/lib/plans";
import { generateApiKey } from "@/lib/integrations/utils/keyUtils";
import IntegrationKey from "@/app/models/integrationKey";
import WebhookSubscription from "@/app/models/webhookSubscription";
import SyncLog from "@/app/models/syncLog";
import WeighbridgeTicket from "@/app/models/weighbridgeTicket";
import { StockMovement } from "@/app/models/stockmovement";
import JournalEntry from "@/app/models/JournalEntry";
import { revalidatePath } from "next/cache";

// ============================================
// INTEGRATION SERVER ACTIONS
// Key management — create, revoke, list.
// Plan-gated: requires "integration" module.
// Role-gated: Admin only.
// ============================================

const ALLOWED_ROLES = ["SuperAdmin", "Admin"];

// ── Helpers ──────────────────────────────────────────────

async function getAuthContext() {
  const { user, companyId } = await getTenantContext();
  if (!ALLOWED_ROLES.includes(user.role)) {
    throw new Error("Only Admin users can manage integration keys");
  }
  if (!planIncludes(user.companyPlan, "integration")) {
    throw new Error("Integration API access requires an Enterprise plan");
  }
  return { user, companyId };
}

// ── Create API Key ────────────────────────────────────────

export async function createIntegrationKey(prevState, formData) {
  try {
    const { user, companyId } = await getAuthContext();
    await dbConnect();

    const name = formData.get("name")?.toString().trim();
    const connectorType = formData.get("connectorType")?.toString();
    const environment = formData.get("environment")?.toString() || "live";
    const scopesRaw = formData.get("scopes")?.toString() || "";
    const notes = formData.get("notes")?.toString().trim() || "";

    // Validation
    if (!name) return { error: "Key name is required" };
    if (!connectorType) return { error: "Connector type is required" };

    const validConnectors = ["weighbridge", "coffee_coop", "logistics", "miller", "generic"];
    if (!validConnectors.includes(connectorType)) {
      return { error: "Invalid connector type" };
    }

    const scopes = scopesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Generate the key
    const generated = generateApiKey(environment);

    await IntegrationKey.create({
      companyId,
      name,
      keyHash: generated.hash,
      keyPreview: generated.preview,
      keyPrefix: generated.prefix,
      connectorType,
      scopes,
      environment,
      notes,
      createdBy: { id: user.id, name: user.name },
    });

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/api-keys");

    // Return plaintext key ONCE — never stored, never recoverable
    return {
      success: true,
      plaintextKey: generated.plaintext,
      message: "API key created. Copy it now — it will not be shown again.",
    };
  } catch (err) {
    return { error: err.message || "Failed to create API key" };
  }
}

// ── Revoke API Key ────────────────────────────────────────

export async function revokeIntegrationKey(keyId) {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const key = await IntegrationKey.findOne({ _id: keyId, companyId });
    if (!key) return { error: "Key not found" };

    key.isActive = false;
    await key.save();

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/api-keys");

    return { success: true };
  } catch (err) {
    return { error: err.message || "Failed to revoke key" };
  }
}

// ── List API Keys (for admin UI) ──────────────────────────

export async function getIntegrationKeys() {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const keys = await IntegrationKey.find({ companyId })
      .sort({ createdAt: -1 })
      .lean();

    return keys.map((k) => ({
      _id: k._id.toString(),
      name: k.name,
      displayKey: `${k.keyPrefix}...${k.keyPreview}`,
      connectorType: k.connectorType,
      scopes: k.scopes,
      environment: k.environment,
      isActive: k.isActive,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: k.lastUsedIp ?? null,
      totalRequests: k.totalRequests ?? 0,
      notes: k.notes,
      createdAt: k.createdAt.toISOString(),
    }));
  } catch (err) {
    return [];
  }
}

// ── Integration Dashboard Stats ───────────────────────────

export async function getIntegrationStats() {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const [keyStats, logStats] = await Promise.all([
      IntegrationKey.aggregate([
        { $match: { companyId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ["$isActive", 1, 0] } },
            totalRequests: { $sum: "$totalRequests" },
          },
        },
      ]),
      SyncLog.aggregate([
        { $match: { companyId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const logMap = {};
    logStats.forEach((s) => { logMap[s._id] = s.count; });

    return {
      keys: {
        total: keyStats[0]?.total ?? 0,
        active: keyStats[0]?.active ?? 0,
        totalRequests: keyStats[0]?.totalRequests ?? 0,
      },
      logs: {
        processed: logMap.processed ?? 0,
        failed: logMap.failed ?? 0,
        pending: (logMap.received ?? 0) + (logMap.processing ?? 0),
      },
    };
  } catch (err) {
    return { keys: { total: 0, active: 0, totalRequests: 0 }, logs: { processed: 0, failed: 0, pending: 0 } };
  }
}

// ── Webhook Subscriptions ─────────────────────────────────

const VALID_EVENTS = [
  "*",
  "invoice.created", "invoice.paid", "invoice.cancelled",
  "receipt.created", "dispatch.created",
  "payment.received", "payment.made",
  "stock.adjusted", "stock.low",
  "weighbridge.ticket_completed",
  "collection.intake_created",
  "order.created", "order.fulfilled",
];

export async function createWebhookSubscription(prevState, formData) {
  try {
    const { user, companyId } = await getAuthContext();
    await dbConnect();

    const name = formData.get("name")?.toString().trim();
    const url = formData.get("url")?.toString().trim();
    const eventsRaw = formData.get("events")?.toString() || "*";
    const connectorType = formData.get("connectorType")?.toString() || null;
    const notes = formData.get("notes")?.toString().trim() || "";

    if (!name) return { error: "Webhook name is required" };
    if (!url) return { error: "URL is required" };
    if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
      return { error: "URL must use HTTPS" };
    }

    const events = eventsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    // Generate a signing secret — random 32 bytes
    const secret = crypto.randomBytes(32).toString("hex");

    await WebhookSubscription.create({
      companyId,
      name,
      url,
      events,
      secret,
      connectorType: connectorType || null,
      notes,
      createdBy: { id: user.id, name: user.name },
    });

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/webhooks");

    return {
      success: true,
      secret,
      message: "Webhook created. Copy the signing secret — it will not be shown again.",
    };
  } catch (err) {
    return { error: err.message || "Failed to create webhook" };
  }
}

export async function deleteWebhookSubscription(subscriptionId) {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const sub = await WebhookSubscription.findOne({ _id: subscriptionId, companyId });
    if (!sub) return { error: "Webhook not found" };

    sub.isActive = false;
    await sub.save();

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/webhooks");

    return { success: true };
  } catch (err) {
    return { error: err.message || "Failed to delete webhook" };
  }
}

export async function getWebhookSubscriptions() {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const subs = await WebhookSubscription.find({ companyId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    return subs.map((s) => ({
      _id: s._id.toString(),
      name: s.name,
      url: s.url,
      events: s.events,
      connectorType: s.connectorType,
      suspended: s.suspended,
      failureCount: s.failureCount,
      lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
      notes: s.notes,
      createdAt: s.createdAt.toISOString(),
    }));
  } catch (err) {
    return [];
  }
}

export async function resumeWebhookSubscription(subscriptionId) {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    await WebhookSubscription.updateOne(
      { _id: subscriptionId, companyId },
      { $set: { suspended: false, failureCount: 0, lastFailureAt: null } }
    );

    revalidatePath("/dashboard/integrations/webhooks");
    return { success: true };
  } catch (err) {
    return { error: err.message || "Failed to resume webhook" };
  }
}

// ── Recent Sync Logs ──────────────────────────────────────

export async function getRecentSyncLogs(limit = 20) {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const logs = await SyncLog.find({ companyId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return logs.map((l) => ({
      _id: l._id.toString(),
      direction: l.direction,
      event: l.event,
      connectorType: l.connectorType,
      externalRef: l.externalRef,
      internalRef: l.internalRef,
      status: l.status,
      error: l.error,
      requestIp: l.requestIp,
      attempts: l.attempts,
      createdAt: l.createdAt.toISOString(),
      processedAt: l.processedAt?.toISOString() ?? null,
    }));
  } catch (err) {
    return [];
  }
}

// ── Weighbridge Tickets (admin UI) ────────────────────────

export async function getWeighbridgeTickets({ status, transactionType, limit = 50 } = {}) {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const query = { companyId };
    if (status)          query.status          = status;
    if (transactionType) query.transactionType = transactionType;

    const tickets = await WeighbridgeTicket.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return tickets.map((t) => ({
      _id:             t._id.toString(),
      ticketNumber:    t.ticketNumber,
      externalRef:     t.externalRef,
      transactionType: t.transactionType,
      direction:       t.direction,
      status:          t.status,
      vehicleReg:      t.vehicleReg,
      driverName:      t.driverName,
      productName:     t.productName,
      partyName:       t.partyName,
      firstWeight:     t.firstWeight,
      secondWeight:    t.secondWeight,
      netWeight:       t.netWeight,
      weightUnit:      t.weightUnit,
      internalRef:     t.internalRef,
      purchaseOrderRef: t.purchaseOrderRef,
      notes:           t.notes,
      warnings:        t.warnings ?? [],
      billRef:         t.billRef         ?? null,
      transferRef:     t.transferRef     ?? null,
      transferCleared: t.transferCleared ?? false,
      linkedTicketId:  t.linkedTicketId?.toString() ?? null,
      completedAt:     t.completedAt?.toISOString() ?? null,
      createdAt:       t.createdAt.toISOString(),
    }));
  } catch (err) {
    return [];
  }
}

export async function getWeighbridgeStats() {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const stats = await WeighbridgeTicket.aggregate([
      { $match: { companyId } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalNet: { $sum: "$netWeight" },
        },
      },
    ]);

    const map = {};
    stats.forEach((s) => { map[s._id] = s; });

    return {
      total: stats.reduce((a, s) => a + s.count, 0),
      completed: map.completed?.count ?? 0,
      pending: (map.pending?.count ?? 0) + (map.gross_recorded?.count ?? 0),
      voided: map.voided?.count ?? 0,
      totalNetKg: map.completed?.totalNet ?? 0,
    };
  } catch (err) {
    return { total: 0, completed: 0, pending: 0, voided: 0, totalNetKg: 0 };
  }
}

// ── Void Weighbridge Ticket (Admin, with full reversal) ───

/**
 * Void a weighbridge ticket — including reversal of its stock movement
 * and journal entry — so the GL and inventory stay clean.
 *
 * Allowed for:
 *   - pending / first_recorded → void only (no GL to reverse)
 *   - completed                → reverse StockMovement + JE, then void
 *
 * NOT allowed once already voided.
 */
export async function voidWeighbridgeTicket(ticketId, reason) {
  try {
    if (!ticketId) return { error: "ticketId is required" };
    if (!reason?.trim()) return { error: "A void reason is required" };

    const { user, companyId } = await getAuthContext();
    await dbConnect();

    const ticket = await WeighbridgeTicket.findOne({ _id: ticketId, companyId });
    if (!ticket) return { error: "Ticket not found" };
    if (ticket.status === "voided") return { error: "Ticket is already voided" };

    const reversals = { movement: null, journalEntry: null };

    if (ticket.status === "completed") {
      // ── Reverse the stock movement ──────────────────────────
      if (ticket.internalId) {
        const movement = await StockMovement.findOne({
          _id:       ticket.internalId,
          companyId,
        });

        if (movement && !movement.isReversed) {
          const reversal = await movement.reverse(
            { id: user.id, name: user.name, role: user.role },
            `WB ticket ${ticket.ticketNumber} voided — ${reason}`
          );
          // movement.reverse() also reverses the linked JE if it exists
          reversals.movement    = reversal.movementNumber;
          reversals.journalEntry = reversal.accounting?.journalEntryId?.toString() ?? null;
        } else if (movement?.isReversed) {
          // Movement was already reversed by another process — safe to proceed
          reversals.movement = "already reversed";
        }
      }
    }

    // ── Mark ticket voided ──────────────────────────────────
    ticket.status    = "voided";
    ticket.voidedAt  = new Date();
    ticket.voidReason = reason.trim();
    ticket.voidedBy  = { id: user.id, name: user.name };
    await ticket.save();

    revalidatePath("/dashboard/integrations/weighbridge");

    return {
      success:     true,
      ticketNumber: ticket.ticketNumber,
      reversals,
      message:
        ticket.status === "voided" &&
        reversals.movement &&
        reversals.movement !== "already reversed"
          ? `Ticket ${ticket.ticketNumber} voided. Stock movement and GL entry reversed.`
          : `Ticket ${ticket.ticketNumber} voided.`,
    };
  } catch (err) {
    return { error: err.message || "Failed to void ticket" };
  }
}
