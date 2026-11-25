import { NextResponse } from "next/server";
import cloudinary from "@/lib/cloudinary";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safe-error";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  // Inventory documents: data sheets, quotations, reports.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
];

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const folder = String(formData.get("folder") || "receipts").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "receipts";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "File type not allowed. Use a photo (JPEG, PNG, WebP, HEIC), PDF, Word or Excel file." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum 10MB." },
        { status: 400 }
      );
    }

    // Convert file to buffer then base64 for Cloudinary
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;

    const isPdf = !file.type.startsWith("image/"); // PDFs and office files are stored as-is

    const result = await cloudinary.uploader.upload(base64, {
      folder: `qalisuite/${folder}`,
      resource_type: isPdf ? "raw" : "auto",
      allowed_formats: isPdf ? undefined : ["jpg", "jpeg", "png", "webp", "heic"],
      transformation: isPdf
        ? undefined
        : [{ quality: "auto", fetch_format: "auto" }],
    });

    return NextResponse.json({
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      filename: file.name,
      size: file.size,
      mimeType: file.type,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Upload failed") },
      { status: 500 }
    );
  }
}
