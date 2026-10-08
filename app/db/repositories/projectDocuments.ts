import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "../client";
import { projectDocuments } from "../schema/projectDocuments";

export async function listDocuments(
  tx: Tx,
  companyId: string,
  projectId: string,
  category?: string | null,
) {
  const where = [
    eq(projectDocuments.companyId, companyId),
    eq(projectDocuments.projectId, projectId),
  ];
  if (category) where.push(eq(projectDocuments.category, category));
  return tx
    .select()
    .from(projectDocuments)
    .where(and(...where))
    .orderBy(desc(projectDocuments.createdAt));
}

export async function addDocument(
  tx: Tx,
  companyId: string,
  input: {
    projectId: string;
    category: string;
    title: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    publicId?: string | null;
    resourceType?: string | null;
    uploadedById?: string | null;
    uploadedByName?: string;
  },
) {
  const [row] = await tx
    .insert(projectDocuments)
    .values({
      companyId,
      projectId: input.projectId,
      category: input.category,
      title: input.title,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      publicId: input.publicId ?? null,
      resourceType: input.resourceType ?? null,
      uploadedById: input.uploadedById ?? null,
      uploadedByName: input.uploadedByName ?? "System",
    })
    .returning();
  return row;
}

export async function deleteDocument(
  tx: Tx,
  companyId: string,
  id: string,
) {
  const [row] = await tx
    .delete(projectDocuments)
    .where(
      and(
        eq(projectDocuments.companyId, companyId),
        eq(projectDocuments.id, id),
      ),
    )
    .returning();
  return row ?? null;
}
