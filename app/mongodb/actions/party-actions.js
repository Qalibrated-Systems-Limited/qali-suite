"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import Party from "../../models/parties";
import connectDB from "../../config/dbConnect";

// ============================================
// ZOD SCHEMAS
// ============================================

const CreatePartySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  type: z.enum(["customer", "supplier", "employee", "both"], {
    required_error: "Party type is required",
  }),
  displayName: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  taxPin: z
    .string()
    .regex(/^[A-Z]\d{9}[A-Z]$/, "Invalid KRA PIN format (A000000000X)")
    .optional()
    .or(z.literal("")),
  employeeNumber: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  isContractor: z.boolean().optional(),
  whtApplicable: z.boolean().optional(),
  whtRate: z.coerce.number().min(0).max(20).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  paymentTermsDays: z.coerce.number().min(0).optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  notes: z.string().optional(),
});

const UpdatePartySchema = CreatePartySchema.partial();

const CreateEmployeePartySchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  employeeNumber: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  taxPin: z.string().optional(),
});

// ============================================
// PARTY ACTIONS
// ============================================

/**
 * Create a new party (customer/supplier/employee)
 */
export async function createParty(prevState, formData) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: {
        _form: ["You must be logged in"],
      },
    };
  }

  if (!["Admin", "Accountant"].includes(session.user.role)) {
    return {
      errors: {
        _form: ["Unauthorized: Admin or Accountant role required"],
      },
    };
  }

  // Validate
  const validatedFields = CreatePartySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    taxPin: formData.get("taxPin"),
    employeeNumber: formData.get("employeeNumber"),
    department: formData.get("department"),
    designation: formData.get("designation"),
    isContractor: formData.get("isContractor") === "true",
    whtApplicable: formData.get("whtApplicable") === "true",
    whtRate: formData.get("whtRate"),
    creditLimit: formData.get("creditLimit"),
    paymentTermsDays: formData.get("paymentTermsDays"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    notes: formData.get("notes"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    // Check for duplicate email
    if (data.email) {
      const existingEmail = await Party.findOne({
        email: data.email.toLowerCase(),
      });
      if (existingEmail) {
        return {
          errors: {
            email: ["A party with this email already exists"],
          },
        };
      }
    }

    // Check for duplicate tax PIN
    if (data.taxPin) {
      const existingPin = await Party.findOne({
        taxPin: data.taxPin.toUpperCase(),
      });
      if (existingPin) {
        return {
          errors: {
            taxPin: ["A party with this KRA PIN already exists"],
          },
        };
      }
    }

    // Create party
    await Party.create({
      ...data,
      email: data.email?.toLowerCase(),
      taxPin: data.taxPin?.toUpperCase(),
      creditTerms: {
        creditLimit: data.creditLimit || 0,
        paymentTermsDays: data.paymentTermsDays || 30,
      },
      paymentDetails: {
        bankName: data.bankName,
        accountNumber: data.accountNumber,
      },
      createdBy: {
        name: session.user.name,
        id: session.user.id,
      },
      lastModifiedBy: {
        name: session.user.name,
        id: session.user.id,
      },
    });

    // Revalidate
    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/employees");

    return {
      success: true,
      message: `${
        data.type.charAt(0).toUpperCase() + data.type.slice(1)
      } created successfully`,
    };
  } catch (error) {
    console.error("Create party error:", error);
    return {
      errors: {
        _form: [error.message || "Failed to create party"],
      },
    };
  }
}

/**
 * Update existing party
 * Uses bind() to pass partyId
 */
export async function updateParty(partyId, prevState, formData) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (!["Admin", "Accountant"].includes(session.user.role)) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  // Validate
  const validatedFields = UpdatePartySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    taxPin: formData.get("taxPin"),
    employeeNumber: formData.get("employeeNumber"),
    department: formData.get("department"),
    designation: formData.get("designation"),
    isContractor: formData.get("isContractor") === "true",
    whtApplicable: formData.get("whtApplicable") === "true",
    whtRate: formData.get("whtRate"),
    creditLimit: formData.get("creditLimit"),
    paymentTermsDays: formData.get("paymentTermsDays"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    notes: formData.get("notes"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    const party = await Party.findById(partyId);
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Check for duplicate email (excluding current party)
    if (data.email && data.email !== party.email) {
      const existingEmail = await Party.findOne({
        email: data.email.toLowerCase(),
        _id: { $ne: partyId },
      });
      if (existingEmail) {
        return {
          errors: { email: ["A party with this email already exists"] },
        };
      }
    }

    // Check for duplicate tax PIN (excluding current party)
    if (data.taxPin && data.taxPin !== party.taxPin) {
      const existingPin = await Party.findOne({
        taxPin: data.taxPin.toUpperCase(),
        _id: { $ne: partyId },
      });
      if (existingPin) {
        return {
          errors: { taxPin: ["A party with this KRA PIN already exists"] },
        };
      }
    }

    // Update party
    Object.keys(data).forEach((key) => {
      if (data[key] !== undefined) {
        if (key === "email" && data.email) {
          party.email = data.email.toLowerCase();
        } else if (key === "taxPin" && data.taxPin) {
          party.taxPin = data.taxPin.toUpperCase();
        } else if (key === "creditLimit" || key === "paymentTermsDays") {
          if (!party.creditTerms) party.creditTerms = {};
          party.creditTerms[key] = data[key];
        } else if (key === "bankName" || key === "accountNumber") {
          if (!party.paymentDetails) party.paymentDetails = {};
          party.paymentDetails[key] = data[key];
        } else {
          party[key] = data[key];
        }
      }
    });

    party.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await party.save();

    // Revalidate
    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/employees");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: "Party updated successfully",
    };
  } catch (error) {
    console.error("Update party error:", error);
    return {
      errors: { _form: [error.message || "Failed to update party"] },
    };
  }
}

/**
 * Delete party
 * Uses bind() to pass partyId
 */
export async function deleteParty(partyId) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (session.user.role !== "Admin") {
    return {
      errors: { _form: ["Unauthorized: Admin role required"] },
    };
  }

  try {
    await connectDB();

    const party = await Party.findById(partyId);
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Check for transactions
    const JournalEntry = (await import("../../models/JournalEntry")).default;
    const transactionCount = await JournalEntry.countDocuments({
      "party.id": partyId,
    });

    if (transactionCount > 0) {
      // Soft delete
      party.isActive = false;
      party.lastModifiedBy = {
        name: session.user.name,
        id: session.user.id,
      };
      await party.save();

      revalidatePath("/dashboard/parties");
      revalidatePath("/dashboard/customers");
      revalidatePath("/dashboard/suppliers");

      return {
        success: true,
        message: `Party deactivated (${transactionCount} transactions exist)`,
      };
    } else {
      // Hard delete
      await Party.findByIdAndDelete(partyId);

      revalidatePath("/dashboard/parties");
      revalidatePath("/dashboard/customers");
      revalidatePath("/dashboard/suppliers");

      return {
        success: true,
        message: "Party deleted successfully",
      };
    }
  } catch (error) {
    console.error("Delete party error:", error);
    return {
      errors: { _form: [error.message || "Failed to delete party"] },
    };
  }
}

/**
 * Toggle party status (activate/deactivate)
 * Uses bind() to pass partyId and isActive
 */
export async function togglePartyStatus(partyId, isActive) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (!["Admin", "Accountant"].includes(session.user.role)) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  try {
    await connectDB();

    const party = await Party.findById(partyId);
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    party.isActive = isActive;
    party.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: `Party ${isActive ? "activated" : "deactivated"} successfully`,
    };
  } catch (error) {
    console.error("Toggle party status error:", error);
    return {
      errors: { _form: [error.message || "Failed to update party status"] },
    };
  }
}

/**
 * Refresh party balance
 * Uses bind() to pass partyId
 */
export async function refreshPartyBalance(partyId) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (!["Admin", "Accountant"].includes(session.user.role)) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  try {
    await connectDB();

    const party = await Party.findById(partyId);
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    await party.calculateActualBalance();

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);
    revalidatePath("/dashboard/reports/ar-aging");
    revalidatePath("/dashboard/reports/ap-aging");

    return {
      success: true,
      message: "Balance refreshed successfully",
    };
  } catch (error) {
    console.error("Refresh balance error:", error);
    return {
      errors: { _form: [error.message || "Failed to refresh balance"] },
    };
  }
}

/**
 * Refresh all party balances
 */
export async function refreshAllPartyBalances() {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (session.user.role !== "Admin") {
    return {
      errors: { _form: ["Unauthorized: Admin role required"] },
    };
  }

  try {
    await connectDB();

    const parties = await Party.find({ isActive: true });

    let successCount = 0;
    let errorCount = 0;

    for (const party of parties) {
      try {
        await party.calculateActualBalance();
        successCount++;
      } catch (error) {
        console.error(`Failed to refresh balance for ${party.name}:`, error);
        errorCount++;
      }
    }

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/reports/ar-aging");
    revalidatePath("/dashboard/reports/ap-aging");

    return {
      success: true,
      message: `Refreshed ${successCount} balances${
        errorCount > 0 ? ` (${errorCount} errors)` : ""
      }`,
    };
  } catch (error) {
    console.error("Bulk refresh error:", error);
    return {
      errors: { _form: [error.message || "Failed to refresh balances"] },
    };
  }
}

/**
 * Convert party type
 * Uses bind() to pass partyId and newType
 */
export async function convertPartyType(partyId, newType) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (session.user.role !== "Admin") {
    return {
      errors: { _form: ["Unauthorized: Admin role required"] },
    };
  }

  try {
    await connectDB();

    const party = await Party.findById(partyId);
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Validate conversion
    const validConversions = {
      customer: ["both"],
      supplier: ["both"],
      employee: [],
      both: ["customer", "supplier"],
    };

    if (!validConversions[party.type]?.includes(newType)) {
      return {
        errors: {
          _form: [
            `Cannot convert from ${
              party.type
            } to ${newType}. Valid conversions: ${
              validConversions[party.type]?.join(", ") || "none"
            }`,
          ],
        },
      };
    }

    party.type = newType;
    party.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: `Party converted to ${newType} successfully`,
    };
  } catch (error) {
    console.error("Convert party type error:", error);
    return {
      errors: { _form: [error.message || "Failed to convert party type"] },
    };
  }
}

/**
 * Create employee party linked to user
 */
export async function createEmployeeParty(prevState, formData) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (!["Admin", "Accountant"].includes(session.user.role)) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  // Validate
  const validatedFields = CreateEmployeePartySchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    employeeNumber: formData.get("employeeNumber"),
    department: formData.get("department"),
    designation: formData.get("designation"),
    taxPin: formData.get("taxPin"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    // Verify user exists
    const User = (await import("../../models/user")).default;
    const user = await User.findById(data.userId);
    if (!user) {
      return {
        errors: { userId: ["User not found"] },
      };
    }

    // Check if employee party already exists
    const existingParty = await Party.findOne({ userId: data.userId });
    if (existingParty) {
      return {
        errors: { _form: ["Employee party already exists for this user"] },
      };
    }

    // Create employee party
    await Party.create({
      type: "employee",
      userId: data.userId,
      name: data.name || user.name,
      email: data.email || user.email,
      phone: data.phone,
      employeeNumber: data.employeeNumber || user.employeeNumber,
      department: data.department || user.department,
      designation: data.designation,
      taxPin: data.taxPin?.toUpperCase(),
      isActive: true,
      createdBy: {
        name: session.user.name,
        id: session.user.id,
      },
      lastModifiedBy: {
        name: session.user.name,
        id: session.user.id,
      },
    });

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/employees");

    return {
      success: true,
      message: "Employee party created successfully",
    };
  } catch (error) {
    console.error("Create employee party error:", error);
    return {
      errors: { _form: [error.message || "Failed to create employee party"] },
    };
  }
}

/**
 * Link existing user to party
 * Uses bind() to pass userId and partyId
 */
export async function linkUserToParty(userId, partyId) {
  // Auth check
  const session = await auth();
  if (!session?.user) {
    return {
      errors: { _form: ["You must be logged in"] },
    };
  }

  if (session.user.role !== "Admin") {
    return {
      errors: { _form: ["Unauthorized: Admin role required"] },
    };
  }

  try {
    await connectDB();

    // Verify user exists
    const User = (await import("../../models/user")).default;
    const user = await User.findById(userId);
    if (!user) {
      return {
        errors: { _form: ["User not found"] },
      };
    }

    // Verify party exists
    const party = await Party.findById(partyId);
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Check if user already linked
    const existingLink = await Party.findOne({ userId });
    if (existingLink && existingLink._id.toString() !== partyId) {
      return {
        errors: { _form: ["User is already linked to another party"] },
      };
    }

    party.userId = userId;
    party.type = "employee";
    party.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/employees");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: "User linked to party successfully",
    };
  } catch (error) {
    console.error("Link user to party error:", error);
    return {
      errors: { _form: [error.message || "Failed to link user to party"] },
    };
  }
}
