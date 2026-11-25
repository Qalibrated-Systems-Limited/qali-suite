import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./client";
import { INVENTORY_DOC_ENTITIES } from "@/lib/inventory/documents";

/** Writing inventory documents inside a caller's transaction. Not a server action. */

type Entity = keyof typeof INVENTORY_DOC_ENTITIES;
function entityOf(type: string) {
  return (INVENTORY_DOC_ENTITIES as Record<string, { table: string; categories: string[][] }>)[type] ?? null;
}

export interface NewDocument {
  name: string;
  url: string;
  publicId?: string | null;
  mimeType?: string | null;
  size?: number | null;
  category?: string;
  note?: string;
}

function cleanDoc(type: string, d: NewDocument) {
  const url = String(d?.url ?? "");
  if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) throw new Error("Upload the file here rather than linking to it.");
  const cats = entityOf(type)!.categories.map(([v]) => v);
  return {
    name: String(d?.name ?? "").trim().slice(0, 200) || "Document",
    url,
    publicId: d?.publicId ? String(d.publicId).slice(0, 300) : null,
    mimeType: d?.mimeType ? String(d.mimeType).slice(0, 120) : null,
    size: Number.isFinite(Number(d?.size)) ? Math.round(Number(d.size)) : null,
    category: cats.includes(String(d?.category)) ? String(d.category) : "other",
    note: String(d?.note ?? "").trim().slice(0, 500),
  };
}

/** Insert inside a caller's transaction — used when a record is created with files. */
export async function insertDocuments(
  tx: Tx,
  companyId: string,
  user: { id?: string | null; name?: string | null },
  type: Entity | string,
  entityId: string,
  docs: NewDocument[],
) {
  for (const raw of (docs ?? []).slice(0, 20)) {
    const d = cleanDoc(type, raw);
    await tx.execute(sql`
      INSERT INTO inventory_documents
        (company_id, entity_type, entity_id, category, name, url, public_id, mime_type, size_bytes, note, uploaded_by_id, uploaded_by_name)
      VALUES (${companyId}::uuid, ${type}, ${entityId}::uuid, ${d.category}, ${d.name}, ${d.url}, ${d.publicId},
              ${d.mimeType}, ${d.size}, ${d.note}, ${user.id ? String(user.id) : null}, ${user.name || "Staff"})
    `);
  }
}

