import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;

/**
 * Generate a signed URL for a Cloudinary resource.
 * Useful for PDFs or resources blocked by Strict Transformations.
 */
export function getSignedUrl(receipt) {
  if (!receipt?.url) return receipt?.url;

  const isPdf =
    receipt.mimeType === "application/pdf" ||
    receipt.url.toLowerCase().endsWith(".pdf");
  if (!isPdf) return receipt.url;

  // If we have publicId stored, use it directly
  if (receipt.publicId) {
    return cloudinary.url(receipt.publicId, {
      resource_type: receipt.resourceType || "raw",
      type: "upload",
      sign_url: true,
      secure: true,
    });
  }

  // Extract public_id from Cloudinary URL for legacy data
  try {
    const url = new URL(receipt.url);
    const parts = url.pathname.split("/");
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx === -1) return receipt.url;

    const resourceType = parts[uploadIdx - 1] || "image"; // "image" or "raw"
    const afterUpload = parts.slice(uploadIdx + 1);

    // Skip version segment (v1234567890)
    const startIdx =
      afterUpload[0]?.match(/^v\d+$/) ? 1 : 0;
    const fullPath = afterUpload.slice(startIdx).join("/");

    // For image-type resources, Cloudinary stores public_id without extension
    const publicId =
      resourceType === "image"
        ? fullPath.replace(/\.[^/.]+$/, "")
        : fullPath;

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: "upload",
      sign_url: true,
      secure: true,
    });
  } catch {
    return receipt.url;
  }
}
