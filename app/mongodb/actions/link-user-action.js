"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import Party from "@/app/models/parties";
import User from "@/app/models/user";
import connectDB from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

// ============================================
// LINK USER TO EMPLOYEE PARTY
// ============================================

const linkUserSchema = z.object({
  partyId: z.string().min(1, "Party ID is required"),
  userId: z.string().min(1, "User ID is required"),
});

export async function linkUserToParty(prevState, formData) {
  await connectDB();

  try {
    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Validate input
    const validatedFields = linkUserSchema.safeParse({
      partyId: formData.get("partyId"),
      userId: formData.get("userId"),
    });

    if (!validatedFields.success) {
      return {
        success: false,
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const { partyId, userId } = validatedFields.data;

    // Check if party exists and is employee type (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        success: false,
        errors: { _form: ["Party not found"] },
      };
    }

    if (party.type !== "employee") {
      return {
        success: false,
        errors: { _form: ["Party must be of type 'employee'"] },
      };
    }

    // Check if user exists (tenant-scoped)
    const user = await User.findOne(
      withTenantScope({ _id: userId }, companyId, isSuperAdmin)
    );
    if (!user) {
      return {
        success: false,
        errors: { _form: ["User not found"] },
      };
    }

    // Check if party already linked to another user
    if (party.userId && party.userId.toString() !== userId) {
      return {
        success: false,
        errors: {
          _form: ["This employee party is already linked to another user"],
        },
      };
    }

    // Check if user already linked to another party (tenant-scoped)
    const existingLink = await Party.findOne(
      withTenantScope(
        {
          userId: userId,
          type: "employee",
          _id: { $ne: partyId },
        },
        companyId,
        isSuperAdmin
      )
    );

    if (existingLink) {
      return {
        success: false,
        errors: {
          _form: [
            `User is already linked to employee party: ${existingLink.name}`,
          ],
        },
      };
    }

    // Link user to party
    party.userId = userId;
    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: `User ${user.name} successfully linked to ${party.name}`,
    };
  } catch (error) {
    console.error("Link user to party error:", error);
    return {
      success: false,
      errors: { _form: ["Failed to link user to party"] },
    };
  }
}

// ============================================
// UNLINK USER FROM PARTY
// ============================================

export async function unlinkUserFromParty(partyId) {
  await connectDB();

  try {
    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );

    if (!party) {
      return {
        success: false,
        errors: { _form: ["Party not found"] },
      };
    }

    if (!party.userId) {
      return {
        success: false,
        errors: { _form: ["No user linked to this party"] },
      };
    }

    party.userId = null;
    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: "User unlinked successfully",
    };
  } catch (error) {
    console.error("Unlink user error:", error);
    return {
      success: false,
      errors: { _form: ["Failed to unlink user"] },
    };
  }
}