"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as repo from "../repositories/projectDocuments";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

const MANAGE = PROJECT_MANAGE_ROLES as unknown as string[];

export async function getProjectDocuments(
  projectId: string,
  category?: string | null,
) {
  if (!projectId) return [];
  return withAuthorizedTenant([], (tx, { companyId }) =>
    repo.listDocuments(tx, companyId, projectId, category),
  );
}

export async function addProjectDocument(
  projectId: string,
  payload: {
    category?: string;
    title?: string;
    file: {
      url: string;
      filename?: string;
      mimeType?: string;
      size?: number;
      publicId?: string;
      resourceType?: string;
    };
  },
) {
  if (!projectId) return { error: "No project." };
  if (!payload?.file?.url) return { error: "No file uploaded." };
  try {
    await withAuthorizedTenant(MANAGE, async (tx, { user, companyId }) => {
      await repo.addDocument(tx, companyId, {
        projectId,
        category: payload.category || "other",
        title: payload.title || payload.file.filename || "Document",
        fileUrl: payload.file.url,
        fileName: payload.file.filename || "",
        mimeType: payload.file.mimeType || "",
        sizeBytes: Number(payload.file.size) || 0,
        publicId: payload.file.publicId ?? null,
        resourceType: payload.file.resourceType ?? null,
        uploadedById: user?.id ?? null,
        uploadedByName: user?.name ?? "System",
      });
    });
    revalidatePath("/dashboard/projects/documents");
    return { success: true, message: "Document uploaded." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteProjectDocument(id: string) {
  if (!id) return { error: "No document." };
  try {
    const removed = await withAuthorizedTenant(MANAGE, (tx, { companyId }) =>
      repo.deleteDocument(tx, companyId, id),
    );
    // Best-effort cleanup of the Cloudinary asset; never fail the delete on it.
    if (removed?.publicId) {
      try {
        const { default: cloudinary } = await import("@/lib/cloudinary");
        await cloudinary.uploader.destroy(removed.publicId, {
          resource_type: removed.resourceType || "image",
        });
      } catch {
        // The row is gone; a stray asset is harmless and swept later.
      }
    }
    revalidatePath("/dashboard/projects/documents");
    return { success: true, message: "Document removed." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
