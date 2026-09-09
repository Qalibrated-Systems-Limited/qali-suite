"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { checkPlanAccess } from "@/lib/plan-gate";
import { generateApiKey } from "@/lib/integrations/utils/keyUtils";
import * as integrations from "../repositories/integrations";
import * as fulfilment from "../repositories/fulfilment";
import * as stockMovements from "../repositories/stockMovements";

/**
 * Integration administration — the port of app/mongodb/actions/integration-actions.js.
 *
 * WHAT MOVED, beyond the store. Two things the Mongo version did that this
 * does not:
 *
 *   1. THE PLAN GATE READ THE SESSION. `planIncludes(user.companyPlan, ...)`
 *      tests a value copied into the JWT when the user signed in, so a company
 *      that downgraded kept issuing Enterprise API keys until everyone's token
 *      expired — and one that UPGRADED could not issue any until they signed
 *      out and in again, which is the half that generates support tickets.
 *      `checkPlanAccess` reads the subscription from Postgres (0035).
 *
 *   2. EVERY FUNCTION SWALLOWED ITS ERROR. `catch (err) { return [] }` on the
 *      readers means a page whose query failed renders "no API keys" — which
 *      an admin reads as "the keys are gone", and the honest answer is that we
 *      could not tell them. The readers below say so.
 *
 * The RETURN SHAPES are unchanged, deliberately: the ten screens under
 * app/dashboard/integrations read `_id`, `displayKey`, `createdAt` as an ISO
 * string, and this port does not get to rewrite them at the same time.
 */

const ADMIN_ROLES = ["SuperAdmin", "Admin"];

/**
 * Both gates, in the order that gives the better message: a non-admin is told
 * about permission, an admin on the wrong plan is told about the plan.
 *
 * The role check happens inside `withAuthorizedTenant`, against the role for
 * the ACTIVE company rather than the session's home company — which is the
 * difference that matters for a SuperAdmin who has entered a tenant.
 */
async function requireIntegrationPlan() {
  const gate = await checkPlanAccess("integration");
  if (!gate.allowed) {
    throw new Error(
      `Integration API access requires the ${gate.requiredPlan ?? "Enterprise"} plan.`,
    );
  }
}

const VALID_CONNECTORS = [
  "weighbridge",
  "coffee_coop",
  "logistics",
  "miller",
  "generic",
];

/**
 * The scope list, repeated here because a form posts strings and the enum is
 * in the database.
 *
 * Filtering against it rather than passing the raw split through is what turns
 * a typo into "that scope was not granted" at creation, where an admin is
 * looking at the screen — instead of a 23514 from the enum cast, or, in Mongo,
 * a scope that validated fine and silently granted nothing months later.
 */
const VALID_SCOPES = [
  "inventory:read",
  "inventory:write",
  "contacts:read",
  "contacts:write",
  "orders:read",
  "orders:write",
  "invoices:read",
  "invoices:write",
  "hr:read",
  "collection:write",
  "webhooks:manage",
];

// ─────────────────────────────────────────────────────────────────────────────
// API keys
// ─────────────────────────────────────────────────────────────────────────────

export async function createIntegrationKey(
  _prevState: unknown,
  formData: FormData,
) {
  try {
    await requireIntegrationPlan();

    const name = formData.get("name")?.toString().trim();
    const connectorType = formData.get("connectorType")?.toString();
    const environment = formData.get("environment")?.toString() || "live";
    const scopesRaw = formData.get("scopes")?.toString() || "";
    const notes = formData.get("notes")?.toString().trim() || "";

    if (!name) return { error: "Key name is required" };
    if (!connectorType) return { error: "Connector type is required" };
    if (!VALID_CONNECTORS.includes(connectorType)) {
      return { error: "Invalid connector type" };
    }
    if (environment !== "live" && environment !== "test") {
      return { error: "Environment must be live or test" };
    }

    const requested = scopesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = requested.filter((s) => !VALID_SCOPES.includes(s));
    if (unknown.length) {
      return { error: `Unknown scope: ${unknown.join(", ")}` };
    }

    const generated = generateApiKey(environment);

    await withAuthorizedTenant(ADMIN_ROLES, async (tx, { user, companyId }) => {
      await integrations.createIntegrationKey(tx, companyId, {
        name,
        keyHash: generated.hash,
        keyPreview: generated.preview,
        keyPrefix: generated.prefix,
        connectorType,
        scopes: requested,
        environment,
        notes,
        createdById: user.id,
        createdByName: user.name,
      });
    });

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/api-keys");

    /**
     * The plaintext is returned ONCE and is not stored — only its SHA-256 is.
     * Nothing recovers it afterwards, which is why the message says so.
     */
    return {
      success: true,
      plaintextKey: generated.plaintext,
      message: "API key created. Copy it now — it will not be shown again.",
    };
  } catch (err) {
    return { error: (err as Error).message || "Failed to create API key" };
  }
}

export async function revokeIntegrationKey(keyId: string) {
  try {
    if (!keyId) return { error: "keyId is required" };
    await requireIntegrationPlan();

    const found = await withAuthorizedTenant(ADMIN_ROLES, (tx) =>
      integrations.revokeIntegrationKey(tx, keyId),
    );
    if (!found) return { error: "Key not found" };

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/api-keys");
    return { success: true };
  } catch (err) {
    return { error: (err as Error).message || "Failed to revoke key" };
  }
}

export async function getIntegrationKeys() {
  return withAuthorizedTenant(ADMIN_ROLES, (tx) =>
    integrations.listIntegrationKeys(tx),
  );
}

export async function getIntegrationStats() {
  return withAuthorizedTenant(ADMIN_ROLES, (tx) =>
    integrations.getIntegrationStats(tx),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export async function createWebhookSubscription(
  _prevState: unknown,
  formData: FormData,
) {
  try {
    await requireIntegrationPlan();

    const name = formData.get("name")?.toString().trim();
    const url = formData.get("url")?.toString().trim();
    const eventsRaw = formData.get("events")?.toString() || "*";
    const connectorType = formData.get("connectorType")?.toString() || null;
    const notes = formData.get("notes")?.toString().trim() || "";

    if (!name) return { error: "Webhook name is required" };
    if (!url) return { error: "URL is required" };
    /**
     * Checked here for the message, and again by
     * `webhook_subscriptions_url_scheme` for the guarantee — a subscription
     * written by any other path cannot ship signed payloads over plaintext.
     */
    if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
      return { error: "URL must use HTTPS" };
    }
    if (connectorType && !VALID_CONNECTORS.includes(connectorType)) {
      return { error: "Invalid connector type" };
    }

    const events = eventsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!events.length) return { error: "At least one event is required" };

    const secret = crypto.randomBytes(32).toString("hex");

    await withAuthorizedTenant(ADMIN_ROLES, async (tx, { user, companyId }) => {
      await integrations.createWebhookSubscription(tx, companyId, {
        name,
        url,
        events,
        secret,
        connectorType,
        notes,
        createdById: user.id,
        createdByName: user.name,
      });
    });

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/webhooks");

    return {
      success: true,
      secret,
      message:
        "Webhook created. Copy the signing secret — it will not be shown again.",
    };
  } catch (err) {
    return { error: (err as Error).message || "Failed to create webhook" };
  }
}

export async function deleteWebhookSubscription(subscriptionId: string) {
  try {
    if (!subscriptionId) return { error: "subscriptionId is required" };
    await requireIntegrationPlan();

    const found = await withAuthorizedTenant(ADMIN_ROLES, (tx) =>
      integrations.deactivateWebhookSubscription(tx, subscriptionId),
    );
    if (!found) return { error: "Webhook not found" };

    revalidatePath("/dashboard/integrations");
    revalidatePath("/dashboard/integrations/webhooks");
    return { success: true };
  } catch (err) {
    return { error: (err as Error).message || "Failed to delete webhook" };
  }
}

export async function resumeWebhookSubscription(subscriptionId: string) {
  try {
    if (!subscriptionId) return { error: "subscriptionId is required" };
    await requireIntegrationPlan();

    const found = await withAuthorizedTenant(ADMIN_ROLES, (tx) =>
      integrations.resumeWebhookSubscription(tx, subscriptionId),
    );
    if (!found) return { error: "Webhook not found" };

    revalidatePath("/dashboard/integrations/webhooks");
    return { success: true };
  } catch (err) {
    return { error: (err as Error).message || "Failed to resume webhook" };
  }
}

export async function getWebhookSubscriptions() {
  return withAuthorizedTenant(ADMIN_ROLES, (tx) =>
    integrations.listWebhookSubscriptions(tx),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync logs
// ─────────────────────────────────────────────────────────────────────────────

export async function getRecentSyncLogs(limit = 20) {
  return withAuthorizedTenant(ADMIN_ROLES, (tx) =>
    integrations.listRecentSyncLogs(tx, limit),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Weighbridge (admin UI)
//
// The tickets themselves have been in Postgres since 0022; only these three
// readers were still going to Mongo, so the integrations dashboard was showing
// a DIFFERENT SET OF TICKETS from the one the gate connector was writing to.
// ─────────────────────────────────────────────────────────────────────────────

export async function getWeighbridgeTickets(
  opts: {
    status?: "pending" | "first_recorded" | "completed" | "voided";
    transactionType?: string;
    limit?: number;
  } = {},
) {
  return withAuthorizedTenant(ADMIN_ROLES, async (tx) => {
    const rows = await fulfilment.listWeighbridgeTickets(tx, {
      status: opts.status,
      transactionType: opts.transactionType as never,
      limit: opts.limit ?? 50,
    });
    return rows.map((t) => ({
      _id: String(t.id),
      id: String(t.id),
      ticketNumber: t.ticketNumber,
      externalRef: t.externalRef,
      transactionType: t.transactionType,
      direction: t.direction,
      status: t.status,
      vehicleReg: t.vehicleReg,
      driverName: t.driverName,
      /**
       * The screen reads `productName` and `partyName`; the columns are
       * `product_name_at_ticket` and `party_name_at_ticket` — the name AS IT
       * WAS when the truck was weighed, which is the point of storing it. The
       * screen's names are kept so it does not have to change.
       */
      productName: t.productNameAtTicket,
      partyName: t.partyNameAtTicket,
      firstWeight: t.firstWeight,
      secondWeight: t.secondWeight,
      netWeight: t.netWeight,
      weightUnit: t.weightUnit,
      internalRef: t.internalRef,
      purchaseOrderRef: t.purchaseOrderRef,
      notes: t.notes,
      warnings: t.warnings ?? [],
      billRef: t.billRef ?? null,
      transferRef: t.transferRef ?? null,
      transferCleared: t.transferCleared ?? false,
      linkedTicketId: t.linkedTicketId ? String(t.linkedTicketId) : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
    }));
  });
}

export async function getWeighbridgeStats() {
  return withAuthorizedTenant(ADMIN_ROLES, (tx) =>
    fulfilment.getWeighbridgeStats(tx),
  );
}

/**
 * Void a ticket, reversing what it posted.
 *
 * THE WHOLE THING IS ONE TRANSACTION, which the Mongo version could not be:
 * there, voiding a completed ticket saved the movement reversal and then saved
 * the ticket, so a failure between them left stock reversed against a ticket
 * that still read `completed` — and the next void attempt would reverse it
 * again. Here both happen or neither does.
 */
export async function voidWeighbridgeTicket(ticketId: string, reason: string) {
  try {
    if (!ticketId) return { error: "ticketId is required" };
    if (!reason?.trim()) return { error: "A void reason is required" };

    return await withAuthorizedTenant(ADMIN_ROLES, async (tx, { user }) => {
      const ticket = await fulfilment.getWeighbridgeTicketById(tx, ticketId);
      if (!ticket) return { error: "Ticket not found" };
      if (ticket.status === "voided") {
        return { error: "Ticket is already voided" };
      }

      const reversals: { movement: string | null } = { movement: null };

      if (ticket.status === "completed" && ticket.internalId) {
        const movement = await stockMovements.getMovement(
          tx,
          String(ticket.internalId),
        );
        if (movement && !movement.isReversed) {
          const reversal = await stockMovements.reverseMovement(
            tx,
            String(ticket.internalId),
            user.id,
          );
          reversals.movement = reversal.movementNumber;
        } else if (movement?.isReversed) {
          /**
           * Another path got there first. Not an error — the goal is that the
           * movement ends up reversed, and it is — but it must not be reported
           * as work this void did.
           */
          reversals.movement = "already reversed";
        }
      }

      await fulfilment.voidWeighbridgeTicket(
        tx,
        ticketId,
        user.id,
        reason.trim(),
      );

      revalidatePath("/dashboard/integrations/weighbridge");

      const reversed =
        reversals.movement && reversals.movement !== "already reversed";
      return {
        success: true,
        ticketNumber: ticket.ticketNumber,
        reversals,
        message: reversed
          ? `Ticket ${ticket.ticketNumber} voided. Stock movement and GL entry reversed.`
          : `Ticket ${ticket.ticketNumber} voided.`,
      };
    });
  } catch (err) {
    return { error: (err as Error).message || "Failed to void ticket" };
  }
}
