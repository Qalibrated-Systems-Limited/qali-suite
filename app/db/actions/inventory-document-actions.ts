"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { INVENTORY_DOC_ENTITIES } from "@/lib/inventory/documents";
import { insertDocuments, type NewDocument } from "../inventoryDocumentsService";

/**
 * Documents attached to inventory records (inventory_records_carry_attached_documents).
 *
 * Anyone who can open the record can see its documents. Attaching is for the
 * people who work the stock; removing is for whoever attached it, or a
 * manager. Only files from the upload store are accepted, so a document is
 * never a link to somewhere else.
 */

const ATTACH_ROLES = [
  "SuperAdmin", "Admin", "Manager", "Store Manager", "Storekeeper", "Procurement Officer",
  "CFO", "Finance Manager", "Accountant", "Sales Manager",
];
const REMOVE_ANY_ROLES = ["SuperAdmin", "Admin", "Manager", "Store Manager"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0];

function entityOf(type: string) {
  return (INVENTORY_DOC_ENTITIES as Record<string, { table: string; categories: string[][] }>)[type] ?? null;
}

const PATHS: Record<string, (id: string) => string> = {
  product: (id) => `/dashboard/stocks/${id}`,
  goods_receipt: (id) => `/dashboard/grn/${id}`,
  stock_adjustment: (id) => `/dashboard/adjustments/${id}`,
  stock_count: (id) => `/dashboard/stock-counts/${id}`,
  nonconformance: (id) => `/dashboard/ncr/${id}`,
  stock_request: (id) => `/dashboard/requests/${id}`,
};

async function recordExists(tx: Tx, type: string, id: string) {
  const e = entityOf(type);
  if (!e || !UUID.test(id)) return false;
  const [r] = (await tx.execute(
    sql`SELECT 1 AS ok FROM ${sql.identifier(e.table)}
         WHERE id = ${id}::uuid AND company_id = NULLIF(current_setting('app.company_id', true), '')::uuid`,
  )) as unknown as Array<{ ok: number }>;
  return Boolean(r);
}

export async function listInventoryDocuments(type: string, entityId: string) {
  if (!entityOf(type) || !UUID.test(entityId)) return [];
  try {
    return await withAuthorizedTenant([], async (tx, { user }) => {
      const rows = (await tx.execute(sql`
        SELECT id::text AS id, category, name, url, mime_type AS "mimeType", size_bytes AS size, note,
               uploaded_by_id AS "uploadedById", uploaded_by_name AS "uploadedByName", uploaded_at AS "uploadedAt"
          FROM inventory_documents
         WHERE entity_type = ${type} AND entity_id = ${entityId}::uuid
         ORDER BY uploaded_at DESC
      `)) as unknown as Array<Record<string, unknown>>;
      const me = String(user.id ?? "");
      const canRemoveAny = REMOVE_ANY_ROLES.includes(String(user.role));
      return rows.map((r) => ({
        ...r,
        uploadedAt: r.uploadedAt instanceof Date ? r.uploadedAt.toISOString() : r.uploadedAt,
        canRemove: canRemoveAny || r.uploadedById === me,
      }));
    });
  } catch {
    return [];
  }
}

export async function attachInventoryDocuments(type: string, entityId: string, docs: NewDocument[]) {
  if (!entityOf(type)) return { success: false, error: "Unknown record type." };
  if (!Array.isArray(docs) || docs.length === 0) return { success: false, error: "Choose a file to attach." };
  try {
    await withAuthorizedTenant(ATTACH_ROLES, async (tx, { user, companyId }) => {
      if (!(await recordExists(tx, type, entityId))) throw new Error("That record was not found.");
      await insertDocuments(tx, companyId, user, type, entityId, docs);
    });
    revalidatePath(PATHS[type](entityId));
    return { success: true, message: docs.length === 1 ? "Document attached" : `${docs.length} documents attached` };
  } catch (error) {
    return { success: false, error: userMessage(error, "Could not attach the document.") };
  }
}

export async function removeInventoryDocument(id: string) {
  if (!UUID.test(String(id))) return { success: false, error: "Document not found." };
  try {
    const row = await withAuthorizedTenant([], async (tx, { user }) => {
      const canRemoveAny = REMOVE_ANY_ROLES.includes(String(user.role));
      const [r] = (await tx.execute(sql`
        DELETE FROM inventory_documents
         WHERE id = ${id}::uuid AND (${canRemoveAny} OR uploaded_by_id = ${String(user.id ?? "")})
        RETURNING entity_type AS "type", entity_id::text AS "entityId"
      `)) as unknown as Array<{ type: string; entityId: string }>;
      if (!r) throw new Error("Only the person who attached it, or a manager, can remove it.");
      return r;
    });
    revalidatePath(PATHS[row.type]?.(row.entityId) ?? "/dashboard");
    return { success: true, message: "Document removed" };
  } catch (error) {
    return { success: false, error: userMessage(error, "Could not remove the document.") };
  }
}
