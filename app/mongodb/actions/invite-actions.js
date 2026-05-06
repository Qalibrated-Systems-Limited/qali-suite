"use server";

import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
import Invite from "@/app/models/invite";
import User from "@/app/models/user";
import Company from "@/app/models/Company";
import Party from "@/app/models/parties";
import EmployeeProfile from "@/app/models/employeeProfile";
import { userRoles } from "@/lib/utils";
import { sendInviteEmail } from "@/lib/email";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import crypto from "crypto";
import { checkUserLimit, evaluateUserLimit } from "@/lib/check-user-limit";

const ADMIN_ROLES = ["SuperAdmin", "Admin"];

// ============================================
// SEND INVITE
// ============================================
export async function sendInvite(prevState, formData) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  const email = formData.get("email")?.toString().trim().toLowerCase();
  const role = formData.get("role")?.toString();
  const formCompanyId = formData.get("companyId")?.toString() || null;

  if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
    return { success: false, error: "Unauthorized — Admin role required" };
  }

  if (!email) {
    return { success: false, error: "Email is required" };
  }

  if (!role || !userRoles.includes(role)) {
    return { success: false, error: "Valid role is required" };
  }

  // Admin cannot invite Admin or SuperAdmin
  if (currentUser.role === "Admin" && (role === "Admin" || role === "SuperAdmin")) {
    return { success: false, error: "Only SuperAdmin can invite Admin users" };
  }

  // Determine companyId — SuperAdmin picks from form, Admin uses their own
  const companyId = currentUser.role === "SuperAdmin"
    ? formCompanyId
    : currentUser.companyId;

  if (!companyId) {
    return { success: false, error: currentUser.role === "SuperAdmin" ? "Please select a company" : "No company context found" };
  }

  try {
    const bypassLimit = currentUser.role === "SuperAdmin";

    // One round-trip for everything: pre-flight checks AND user limit data.
    // We also pull subscription fields on Company so evaluateUserLimit can
    // run inline without a second Company.findById.
    const [existingUser, existingInvite, company, activeUserCount] =
      await Promise.all([
        User.findOne({ email }).select("_id").lean(),
        Invite.findOne({
          email,
          companyId,
          status: "pending",
          expiresAt: { $gt: new Date() },
        })
          .select("_id")
          .lean(),
        Company.findById(companyId)
          .select(
            "name subscription.maxUsers subscription.plan subscription.status subscription.currentPeriodEnd subscription.trialEndsAt",
          )
          .lean(),
        // Skip the count when SuperAdmin is bypassing — saves a roundtrip.
        bypassLimit
          ? Promise.resolve(0)
          : User.countDocuments({ companyId, status: { $ne: "Inactive" } }),
      ]);

    if (existingUser) {
      return { success: false, error: "A user with this email already exists" };
    }

    if (existingInvite) {
      return {
        success: false,
        error: "A pending invite already exists for this email",
      };
    }

    if (!company) {
      return { success: false, error: "Company not found" };
    }

    if (!bypassLimit) {
      const limitCheck = evaluateUserLimit({ company, activeUserCount });
      if (!limitCheck.allowed) {
        return { success: false, error: limitCheck.error };
      }
    }

    // Generate token
    const { rawToken, hashedToken } = Invite.generateToken();

    // Create invite
    await Invite.create({
      email,
      role,
      companyId,
      invitedBy: { name: currentUser.name, id: currentUser.id },
      token: hashedToken,
    });

    // Revalidate inline so the page re-renders with the new invite when the
    // action returns. Email send goes to after() so a slow Resend call never
    // blocks the response.
    revalidatePath("/dashboard/users");

    after(async () => {
      try {
        await sendInviteEmail({
          to: email,
          inviterName: currentUser.name,
          companyName: company.name,
          role,
          rawToken,
        });
      } catch (err) {
        console.error("Failed to send invite email:", err);
      }
    });

    return { success: true, message: `Invite sent to ${email}` };
  } catch (error) {
    console.error("Send invite error:", error);
    return { success: false, error: error.message || "Failed to send invite" };
  }
}

// ============================================
// GET INVITE BY TOKEN (public — for accept page)
// ============================================
export async function getInviteByToken(rawToken) {
  await dbConnect();

  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const invite = await Invite.findOne({ token: hashedToken })
      .populate("companyId", "name")
      .lean();

    if (!invite) {
      return { valid: false, error: "Invite not found" };
    }

    if (invite.status === "accepted") {
      return { valid: false, error: "This invite has already been used" };
    }

    if (invite.status === "cancelled") {
      return { valid: false, error: "This invite has been cancelled" };
    }

    if (new Date(invite.expiresAt) < new Date()) {
      return { valid: false, error: "This invite has expired" };
    }

    return {
      valid: true,
      invite: {
        email: invite.email,
        role: invite.role,
        companyName: invite.companyId?.name || "Unknown",
        invitedBy: invite.invitedBy.name,
        expiresAt: invite.expiresAt.toISOString(),
      },
    };
  } catch (error) {
    console.error("Get invite error:", error);
    return { valid: false, error: "Failed to validate invite" };
  }
}

// ============================================
// ACCEPT INVITE WITH PASSWORD
// ============================================
export async function acceptInviteWithPassword(rawToken, formData) {
  await dbConnect();

  const name = formData.get("name")?.toString().trim();
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();

  if (!name || name.length < 1) {
    return { success: false, error: "Name is required" };
  }

  if (name.length > 50) {
    return { success: false, error: "Name cannot exceed 50 characters" };
  }

  if (!password || password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }

  if (password !== confirmPassword) {
    return { success: false, error: "Passwords do not match" };
  }

  try {
    const invite = await Invite.findByToken(rawToken);

    if (!invite) {
      return { success: false, error: "Invalid, expired, or already used invite" };
    }

    // Check if user already exists (e.g., created by admin via Create User)
    const existingUser = await User.findOne({ email: invite.email }).select("+password");
    if (existingUser) {
      if (existingUser.password) {
        // User already has a password — they should just sign in
        invite.status = "accepted";
        invite.acceptedAt = new Date();
        await invite.save();
        return { success: false, error: "An account with this email already exists. Please sign in instead." };
      }

      // User exists but has no password — set their name and password, preserve existing role
      existingUser.name = name;
      existingUser.password = password;
      const hasExistingRole = existingUser.role && existingUser.role !== "User" && existingUser.role !== "Viewer";
      if (!hasExistingRole) existingUser.role = invite.role;
      if (!existingUser.companyId) existingUser.companyId = invite.companyId;
      existingUser.authProvider = "credentials";
      await existingUser.save();

      // Link to employee profile if this is an employee invite
      // Complete the triangle: User.partyId ↔ Party.userId ↔ EmployeeProfile.userId
      if (invite.partyId) {
        await Promise.all([
          Party.findByIdAndUpdate(invite.partyId, { userId: existingUser._id }),
          EmployeeProfile.findOneAndUpdate(
            { partyId: invite.partyId },
            { userId: existingUser._id }
          ),
          User.findByIdAndUpdate(existingUser._id, { partyId: invite.partyId }),
        ]);
      }

      invite.status = "accepted";
      invite.acceptedAt = new Date();
      await invite.save();

      return { success: true, message: "Password set! You can now sign in." };
    }

    // Check user limit before creating new user
    const limitCheck = await checkUserLimit(invite.companyId);
    if (!limitCheck.allowed) {
      return { success: false, error: limitCheck.error };
    }

    // No existing user — create one
    const newUser = await User.create({
      name,
      email: invite.email,
      password,
      role: invite.role,
      companyId: invite.companyId,
      authProvider: "credentials",
      creator: invite.invitedBy,
    });

    // If this is an employee portal invite, link the new User back to
    // the employee's Party and EmployeeProfile records.
    // This completes the triangle: User ↔ Party ↔ EmployeeProfile
    // Complete the triangle: User.partyId ↔ Party.userId ↔ EmployeeProfile.userId
    if (invite.partyId) {
      await Promise.all([
        Party.findByIdAndUpdate(invite.partyId, { userId: newUser._id }),
        EmployeeProfile.findOneAndUpdate(
          { partyId: invite.partyId },
          { userId: newUser._id }
        ),
        User.findByIdAndUpdate(newUser._id, { partyId: invite.partyId }),
      ]);
    }

    invite.status = "accepted";
    invite.acceptedAt = new Date();
    await invite.save();

    return { success: true, message: "Account created! You can now sign in." };
  } catch (error) {
    console.error("Accept invite error:", error);
    return { success: false, error: error.message || "Failed to create account" };
  }
}

// ============================================
// CANCEL INVITE (Admin)
// ============================================
export async function cancelInvite(inviteId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // SuperAdmin can cancel any invite; Admin only their company's
    const query = { _id: inviteId, status: "pending" };
    if (currentUser.role !== "SuperAdmin" && currentUser.companyId) {
      query.companyId = currentUser.companyId;
    }

    const invite = await Invite.findOne(query);
    if (!invite) {
      return { success: false, error: "Invite not found or already processed" };
    }

    invite.status = "cancelled";
    await invite.save();

    revalidatePath("/dashboard/users");
    return { success: true, message: "Invite cancelled" };
  } catch (error) {
    console.error("Cancel invite error:", error);
    return { success: false, error: error.message || "Failed to cancel invite" };
  }
}

// ============================================
// RESEND INVITE (Admin)
// ============================================
export async function resendInvite(inviteId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // SuperAdmin can resend any invite; Admin only their company's
    const query = { _id: inviteId, status: "pending" };
    if (currentUser.role !== "SuperAdmin" && currentUser.companyId) {
      query.companyId = currentUser.companyId;
    }

    const invite = await Invite.findOne(query);
    if (!invite) {
      return { success: false, error: "Invite not found or already processed" };
    }

    // Generate new token and extend expiry
    const { rawToken, hashedToken } = Invite.generateToken();
    invite.token = hashedToken;
    invite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Save invite and fetch company name in parallel
    const [, company] = await Promise.all([
      invite.save(),
      Company.findById(invite.companyId).select("name").lean(),
    ]);

    // Send email in background — don't block the response
    sendInviteEmail({
      to: invite.email,
      inviterName: currentUser.name,
      companyName: company?.name || "Your Company",
      role: invite.role,
      rawToken,
    }).catch((err) => console.error("Failed to resend invite email:", err));

    revalidatePath("/dashboard/users");
    return { success: true, message: `Invite resent to ${invite.email}` };
  } catch (error) {
    console.error("Resend invite error:", error);
    return { success: false, error: error.message || "Failed to resend invite" };
  }
}

// ============================================
// GET COMPANY INVITES (Admin)
// ============================================
export async function getCompanyInvites() {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
    return { invites: [], error: "Unauthorized" };
  }

  try {
    const { companyId, isSuperAdmin } = await getTenantContext();

    // SuperAdmin sees all invites, Admin sees only their company's
    const query = isSuperAdmin ? {} : { companyId };
    const invites = await Invite.find(query)
      .populate("companyId", "name")
      .sort({ createdAt: -1 })
      .lean();

    const serialized = invites.map((inv) => ({
      _id: inv._id.toString(),
      email: inv.email,
      role: inv.role,
      status: inv.status,
      invitedBy: inv.invitedBy.name,
      companyName: inv.companyId?.name || "Unknown",
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      isExpired: inv.status === "pending" && new Date(inv.expiresAt) < new Date(),
    }));

    return { invites: serialized, error: null };
  } catch (error) {
    console.error("Get invites error:", error);
    return { invites: [], error: error.message };
  }
}
