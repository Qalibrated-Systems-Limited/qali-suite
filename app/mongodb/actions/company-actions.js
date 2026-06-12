"use server";

import { z } from "zod";
import mongoose from "mongoose";
import { resetCompanyData } from "@/lib/company-reset";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Company from "../../models/Company";
import Account from "../../models/account";
import connectDB from "../../config/dbConnect";
import { updateSubscription } from "@/lib/subscription-helpers";
import { getPlanLimits } from "@/lib/plans";

// ============================================
// SUBSCRIPTION INITIALIZATION
// ============================================
// Single source of truth for "what does a new company's subscription
// look like?" — keeps maxUsers in sync with plan and applies the
// industry-standard rule: free plan starts ACTIVE (permanent free tier),
// paid plans start in TRIAL with a 14-day window. Without this, every
// company defaulted to maxUsers=2 (the schema default) regardless of
// plan, so paid-tier signups hit the user limit immediately.
function buildInitialSubscription(plan) {
  const limits = getPlanLimits(plan);
  if (plan === "free") {
    // Free is permanent — no trial, no period, no expiry. Industry
    // standard: free is the post-trial fallback, not a paid trial.
    return {
      plan: "free",
      status: "active",
      maxUsers: limits.maxUsers,
    };
  }
  // Paid plan: 14-day trial of the chosen tier.
  return {
    plan,
    status: "trial",
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    maxUsers: limits.maxUsers,
  };
}

// ============================================
// ZOD SCHEMAS
// ============================================

// Helper to transform empty string/null to undefined for optional strings
const optionalString = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === "" || val === null ? undefined : val));

// Helper for optional URL - allows empty string or valid URL
const optionalUrl = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === "" || val === null ? undefined : val))
  .refine((val) => !val || z.string().url().safeParse(val).success, {
    message: "Invalid URL format",
  });

// Helper for optional numbers - handles empty strings
const optionalNumber = (min, max) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((val) => {
      if (val === "" || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    })
    .refine((val) => val === undefined || (val >= min && val <= max), {
      message: `Number must be between ${min} and ${max}`,
    });

const CreateCompanySchema = z.object({
  // Basic Info
  name: z.string().min(1, "Company name is required").max(100),
  code: z
    .string()
    .min(2, "Company code must be at least 2 characters")
    .max(6, "Company code cannot exceed 6 characters")
    .regex(/^[A-Za-z0-9]+$/, "Company code must be alphanumeric")
    .transform((val) => val.toUpperCase()),
  tagline: optionalString.pipe(z.string().max(200).optional()),
  logo: optionalString,

  // Contact
  email: z.string().email("Invalid email address"),
  phone: optionalString,
  website: optionalUrl,

  // Address
  street: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  country: optionalString,

  // Tax & Legal
  taxPin: optionalString,
  vatNumber: optionalString,
  registrationNumber: optionalString,

  // Banking
  bankName: optionalString,
  bankBranch: optionalString,
  accountName: optionalString,
  accountNumber: optionalString,
  swiftCode: optionalString,

  // M-Pesa
  mpesaPaybill: optionalString,
  mpesaTill: optionalString,

  // Subscription
  plan: z.enum(["free", "starter", "professional", "enterprise"]).optional().nullable(),

  // Settings
  currency: optionalString,
  defaultVatRate: optionalNumber(0, 100),
  fiscalYearStart: optionalNumber(1, 12),
  defaultPaymentTermsDays: optionalNumber(0, 365),
  capitalizationThreshold: optionalNumber(0, 1_000_000_000),
  // Three-way-match toggle. Boolean coerced from the form's checkbox
  // value ("true" / unchecked).
  requireGRN: z.coerce.boolean().optional(),
});

const UpdateCompanySchema = CreateCompanySchema.partial();

// ============================================
// AUTHORIZATION HELPERS
// ============================================

const SUPER_ADMIN_ROLES = ["SuperAdmin"];
const COMPANY_ADMIN_ROLES = ["SuperAdmin", "Admin"];

// Helper to safely compare companyIds (handles ObjectId vs string mismatches)
const isSameCompany = (id1, id2) => {
  if (!id1 || !id2) return false;
  return String(id1) === String(id2);
};

// ============================================
// COMPANY ACTIONS
// ============================================

/**
 * Create a new company (SuperAdmin only)
 */
export async function createCompany(prevState, formData) {
  const session = await auth();

  // Extract form values to preserve on error
  const formValues = {
    name: formData.get("name"),
    code: formData.get("code"),
    tagline: formData.get("tagline"),
    logo: formData.get("logo"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    website: formData.get("website"),
    street: formData.get("street"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    country: formData.get("country"),
    taxPin: formData.get("taxPin"),
    vatNumber: formData.get("vatNumber"),
    registrationNumber: formData.get("registrationNumber"),
    bankName: formData.get("bankName"),
    bankBranch: formData.get("bankBranch"),
    accountName: formData.get("accountName"),
    accountNumber: formData.get("accountNumber"),
    swiftCode: formData.get("swiftCode"),
    mpesaPaybill: formData.get("mpesaPaybill"),
    mpesaTill: formData.get("mpesaTill"),
    plan: formData.get("plan"),
    currency: formData.get("currency"),
    defaultVatRate: formData.get("defaultVatRate"),
    fiscalYearStart: formData.get("fiscalYearStart"),
    defaultPaymentTermsDays: formData.get("defaultPaymentTermsDays"),
    capitalizationThreshold: formData.get("capitalizationThreshold"),
  };

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] }, values: formValues };
  }

  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] }, values: formValues };
  }

  const validatedFields = CreateCompanySchema.safeParse(formValues);

  if (!validatedFields.success) {
    console.log(validatedFields.error.flatten().fieldErrors);
    return { errors: validatedFields.error.flatten().fieldErrors, values: formValues };
  }

  const data = validatedFields.data;
  console.log(data);

  try {
    await connectDB();

    // Check for duplicate name or code
    const existingCompany = await Company.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${data.name}$`, "i") } },
        { code: data.code },
      ],
    });

    if (existingCompany) {
      if (existingCompany.code === data.code) {
        return { errors: { code: ["This company code is already in use"] }, values: formValues };
      }
      return { errors: { name: ["A company with this name already exists"] }, values: formValues };
    }

    // Create the company
    const company = await Company.create({
      name: data.name,
      code: data.code,
      tagline: data.tagline,
      logo: data.logo,
      email: data.email,
      phone: data.phone,
      website: data.website,
      address: {
        street: data.street,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country || "Kenya",
      },
      taxPin: data.taxPin,
      vatNumber: data.vatNumber,
      registrationNumber: data.registrationNumber,
      bankName: data.bankName,
      bankBranch: data.bankBranch,
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      swiftCode: data.swiftCode,
      mpesaPaybill: data.mpesaPaybill,
      mpesaTill: data.mpesaTill,
      subscription: buildInitialSubscription(data.plan || "free"),
      settings: {
        currency: data.currency || "KES",
        defaultVatRate: data.defaultVatRate ?? 16,
        fiscalYearStart: data.fiscalYearStart || 1,
        defaultPaymentTermsDays: data.defaultPaymentTermsDays || 30,
        capitalizationThreshold: data.capitalizationThreshold ?? 0,
      },
      createdBy: {
        name: session.user.name,
        id: session.user.id,
      },
    });

    // Seed Chart of Accounts and Fiscal Periods for the new company
    const { CompanyOnboardingService } = await import("../services/companyOnboardingService");

    const fiscalYearStart = new Date(
      new Date().getFullYear(),
      (data.fiscalYearStart || 1) - 1, // Convert month number to 0-indexed
      1
    );

    await CompanyOnboardingService.seedChartOfAccounts(company._id, session.user);
    await CompanyOnboardingService.initializeFiscalPeriods(
      company._id,
      fiscalYearStart,
      session.user
    );

    // Mark setup as completed
    company.settings.setupCompleted = true;
    company.settings.setupCompletedAt = new Date();
    await company.save();

    revalidatePath("/dashboard/admin/companies");
  } catch (error) {
    console.error("Create company error:", error);
    return { errors: { _form: [error.message || "Failed to create company"] }, values: formValues };
  }

  redirect("/dashboard/admin/companies");
}

/**
 * Update a company
 * - SuperAdmin can update any company
 * - Admin can only update their own company
 */
export async function updateCompany(prevState, formData) {
  const session = await auth();

  // Extract form values to preserve on error
  const formValues = {
    name: formData.get("name"),
    code: formData.get("code"),
    tagline: formData.get("tagline"),
    logo: formData.get("logo"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    website: formData.get("website"),
    street: formData.get("street"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    country: formData.get("country"),
    taxPin: formData.get("taxPin"),
    vatNumber: formData.get("vatNumber"),
    registrationNumber: formData.get("registrationNumber"),
    bankName: formData.get("bankName"),
    bankBranch: formData.get("bankBranch"),
    accountName: formData.get("accountName"),
    accountNumber: formData.get("accountNumber"),
    swiftCode: formData.get("swiftCode"),
    mpesaPaybill: formData.get("mpesaPaybill"),
    mpesaTill: formData.get("mpesaTill"),
    currency: formData.get("currency"),
    defaultVatRate: formData.get("defaultVatRate"),
    fiscalYearStart: formData.get("fiscalYearStart"),
    defaultPaymentTermsDays: formData.get("defaultPaymentTermsDays"),
    capitalizationThreshold: formData.get("capitalizationThreshold"),
    // Three-way-match toggle. HTML checkboxes submit "true" when
    // checked and nothing when unchecked — coerce both states into
    // an explicit boolean so the action can detect "user unchecked
    // the box" vs. "user didn't touch it".
    requireGRN: formData.get("requireGRN") === "true",
  };

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] }, values: formValues };
  }

  if (!COMPANY_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: Admin role required"] }, values: formValues };
  }

  const companyId = formData.get("companyId");
  if (!companyId) {
    return { errors: { _form: ["Company ID is required"] }, values: formValues };
  }

  const validatedFields = UpdateCompanySchema.safeParse(formValues);

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors, values: formValues };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    const company = await Company.findById(companyId);
    if (!company) {
      return { errors: { _form: ["Company not found"] }, values: formValues };
    }

    // If not SuperAdmin, check if user belongs to this company
    if (
      session.user.role !== "SuperAdmin" &&
      !isSameCompany(session.user.companyId, companyId)
    ) {
      return { errors: { _form: ["You can only update your own company"] }, values: formValues };
    }

    // Update fields
    if (data.name) company.name = data.name;

    // Handle company code:
    // - SuperAdmin can always update the code
    // - Admin can set the code only if company doesn't have one yet (initial setup)
    // - If company has no code and none provided, auto-generate from name
    if (data.code) {
      const canUpdateCode = session.user.role === "SuperAdmin" || !company.code;
      if (canUpdateCode) {
        // Check if new code is already in use by another company
        const codeInUse = await Company.findOne({
          code: data.code.toUpperCase(),
          _id: { $ne: companyId }
        });
        if (codeInUse) {
          return { errors: { code: ["This company code is already in use"] }, values: formValues };
        }
        company.code = data.code.toUpperCase();
      }
    } else if (!company.code) {
      // Auto-generate code from company name if not provided and company has no code
      const nameToUse = data.name || company.name;
      let generatedCode = nameToUse
        .split(/\s+/)
        .map(word => word[0])
        .join("")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);

      if (generatedCode.length < 2) {
        generatedCode = nameToUse.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      }

      // Ensure uniqueness
      let finalCode = generatedCode;
      let suffix = 1;
      while (await Company.findOne({ code: finalCode, _id: { $ne: companyId } })) {
        finalCode = `${generatedCode.slice(0, 4)}${suffix}`;
        suffix++;
      }
      company.code = finalCode;
    }
    if (data.tagline !== undefined) company.tagline = data.tagline;
    if (data.logo !== undefined) company.logo = data.logo;
    if (data.email) company.email = data.email;
    if (data.phone !== undefined) company.phone = data.phone;
    if (data.website !== undefined) company.website = data.website;

    // Address
    if (data.street !== undefined) company.address.street = data.street;
    if (data.city !== undefined) company.address.city = data.city;
    if (data.state !== undefined) company.address.state = data.state;
    if (data.postalCode !== undefined)
      company.address.postalCode = data.postalCode;
    if (data.country !== undefined) company.address.country = data.country;

    // Tax & Legal
    if (data.taxPin !== undefined) company.taxPin = data.taxPin;
    if (data.vatNumber !== undefined) company.vatNumber = data.vatNumber;
    if (data.registrationNumber !== undefined)
      company.registrationNumber = data.registrationNumber;

    // Banking
    if (data.bankName !== undefined) company.bankName = data.bankName;
    if (data.bankBranch !== undefined) company.bankBranch = data.bankBranch;
    if (data.accountName !== undefined) company.accountName = data.accountName;
    if (data.accountNumber !== undefined)
      company.accountNumber = data.accountNumber;
    if (data.swiftCode !== undefined) company.swiftCode = data.swiftCode;

    // M-Pesa
    if (data.mpesaPaybill !== undefined)
      company.mpesaPaybill = data.mpesaPaybill;
    if (data.mpesaTill !== undefined) company.mpesaTill = data.mpesaTill;

    // Settings
    if (data.currency !== undefined) company.settings.currency = data.currency;
    if (data.defaultVatRate !== undefined)
      company.settings.defaultVatRate = data.defaultVatRate;
    if (data.fiscalYearStart !== undefined)
      company.settings.fiscalYearStart = data.fiscalYearStart;
    if (data.defaultPaymentTermsDays !== undefined)
      company.settings.defaultPaymentTermsDays = data.defaultPaymentTermsDays;
    if (data.capitalizationThreshold !== undefined)
      company.settings.capitalizationThreshold = data.capitalizationThreshold;
    if (data.requireGRN !== undefined) {
      const turningOn = !!data.requireGRN && !company.settings.requireGRN;
      company.settings.requireGRN = !!data.requireGRN;

      // When strict mode is being turned ON, auto-provision the GR/IR
      // Clearing account if the tenant doesn't already have one — saves
      // the user from a "GR/IR account not configured" guard-error on
      // their next bill approval.
      if (turningOn) {
        const existing = await Account.findOne({
          companyId: company._id,
          systemAccount: "grni",
        }).lean();
        if (!existing) {
          try {
            await Account.create({
              companyId: company._id,
              accountCode: "2175",
              accountName: "GR/IR Clearing",
              accountType: "liability",
              subType: "accrual",
              canPost: true,
              isActive: true,
              parentCode: "2100",
              systemAccount: "grni",
            });
          } catch (err) {
            // If account code 2175 collides with an existing account on
            // this tenant, fall back to a unique code by appending a
            // suffix. Better than failing the toggle save.
            console.warn(
              "[updateCompany] GR/IR auto-create at 2175 failed, retrying with suffix:",
              err.message,
            );
            await Account.create({
              companyId: company._id,
              accountCode: `2175-GRNI-${Date.now().toString().slice(-4)}`,
              accountName: "GR/IR Clearing",
              accountType: "liability",
              subType: "accrual",
              canPost: true,
              isActive: true,
              parentCode: "2100",
              systemAccount: "grni",
            });
          }
        }
      }
    }

    // Audit
    company.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await company.save();

    revalidatePath("/dashboard/admin/companies");
    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    revalidatePath("/dashboard/company");
  } catch (error) {
    console.error("Update company error:", error);
    return { errors: { _form: [error.message || "Failed to update company"] }, values: formValues };
  }

  // Redirect based on role (must be outside try/catch)
  if (session.user.role === "SuperAdmin") {
    redirect(`/dashboard/admin/companies/${companyId}`);
  } else {
    redirect("/dashboard/company");
  }
}

/**
 * Update company status (SuperAdmin only)
 */
export async function updateCompanyStatus(companyId, status) {
  const session = await auth();

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] } };
  }

  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] } };
  }

  if (!["active", "inactive", "suspended"].includes(status)) {
    return { errors: { _form: ["Invalid status"] } };
  }

  try {
    await connectDB();

    const company = await Company.findById(companyId);
    if (!company) {
      return { errors: { _form: ["Company not found"] } };
    }

    company.status = status;
    company.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await company.save();

    revalidatePath("/dashboard/admin/companies");

    return { success: true, message: `Company status updated to ${status}` };
  } catch (error) {
    console.error("Update company status error:", error);
    return { errors: { _form: [error.message] } };
  }
}

/**
 * Update company subscription (SuperAdmin only).
 * Delegates to lib/subscription-helpers.updateSubscription so all mutations
 * go through a single audited path.
 */
export async function updateCompanySubscription(companyId, subscriptionData) {
  const session = await auth();

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] } };
  }

  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] } };
  }

  try {
    await connectDB();

    await updateSubscription(
      companyId,
      {
        plan: subscriptionData.plan,
        status: subscriptionData.status,
        maxUsers: subscriptionData.maxUsers,
        trialEndsAt: subscriptionData.trialEndsAt,
        currentPeriodStart: subscriptionData.currentPeriodStart,
        currentPeriodEnd: subscriptionData.currentPeriodEnd,
      },
      { name: session.user.name, id: session.user.id },
      subscriptionData.reason || ""
    );

    revalidatePath("/dashboard/admin/companies");
    return { success: true, message: "Subscription updated successfully" };
  } catch (error) {
    console.error("Update subscription error:", error);
    return { errors: { _form: [error.message] } };
  }
}

/**
 * Toggle company feature (SuperAdmin only)
 */
export async function toggleCompanyFeature(companyId, featureName, enabled) {
  const session = await auth();

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] } };
  }

  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] } };
  }

  const validFeatures = [
    "inventory",
    "sales",
    "purchases",
    "accounting",
    "expenses",
    "reports",
    "multiCurrency",
    "advancedReporting",
    "apiAccess",
  ];

  if (!validFeatures.includes(featureName)) {
    return { errors: { _form: ["Invalid feature name"] } };
  }

  try {
    await connectDB();

    const company = await Company.findById(companyId);
    if (!company) {
      return { errors: { _form: ["Company not found"] } };
    }

    company.features[featureName] = enabled;
    company.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };

    await company.save();

    revalidatePath("/dashboard/admin/companies");

    return {
      success: true,
      message: `Feature ${featureName} ${enabled ? "enabled" : "disabled"}`,
    };
  } catch (error) {
    console.error("Toggle feature error:", error);
    return { errors: { _form: [error.message] } };
  }
}

/**
 * Delete a company (SuperAdmin only)
 * Note: In production, you'd want to soft delete or archive instead
 */
export async function deleteCompany(companyId) {
  const session = await auth();

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] } };
  }

  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] } };
  }

  try {
    await connectDB();

    const company = await Company.findById(companyId);
    if (!company) {
      return { errors: { _form: ["Company not found"] } };
    }

    // Soft delete - just mark as inactive
    company.status = "inactive";
    company.lastModifiedBy = {
      name: session.user.name,
      id: session.user.id,
    };
    await company.save();

    // TODO: In production, you might want to:
    // - Archive all company data
    // - Deactivate all users
    // - Send notification emails

    revalidatePath("/dashboard/admin/companies");

    return { success: true, message: "Company deactivated successfully" };
  } catch (error) {
    console.error("Delete company error:", error);
    return { errors: { _form: [error.message] } };
  }
}

// ============================================
// COMPANY ONBOARDING ACTIONS
// ============================================

import { CompanyOnboardingService } from "../services/companyOnboardingService";

// Onboarding form schema
const OnboardingSchema = z.object({
  name: z.string().min(1, "Company name is required").max(100),
  legalName: optionalString.pipe(z.string().max(150).optional()),
  industry: z.enum([
    "retail",
    "manufacturing",
    "services",
    "technology",
    "healthcare",
    "education",
    "hospitality",
    "construction",
    "agriculture",
    "transport",
    "general",
  ]).optional(),

  // Contact
  contactEmail: z.string().email("Invalid email address"),
  contactPhone: optionalString,
  website: optionalUrl,

  // Address
  street: optionalString,
  city: optionalString,
  county: optionalString,
  postalCode: optionalString,
  country: z.string().default("Kenya"),

  // Tax & Legal (Kenya)
  taxPin: optionalString.pipe(
    z.string().regex(/^[AP]\d{9}[A-Z]$/, "Invalid KRA PIN format").optional().or(z.literal(""))
  ),
  vatNumber: optionalString,
  registrationNumber: optionalString,

  // Settings
  currency: z.enum(["KES", "USD", "EUR", "GBP", "TZS", "UGX"]).default("KES"),
  timezone: z.string().default("Africa/Nairobi"),
  fiscalYearStart: z.coerce.date().optional(),
  vatRate: optionalNumber(0, 100),

  // Document Prefixes
  invoicePrefix: optionalString.pipe(z.string().max(10).optional()),
  billPrefix: optionalString.pipe(z.string().max(10).optional()),
  paymentPrefix: optionalString.pipe(z.string().max(10).optional()),
  quotePrefix: optionalString.pipe(z.string().max(10).optional()),

  // Subscription
  subscriptionPlan: z.enum(["free", "starter", "professional", "enterprise"]).default("free"),

  // Setup Options
  seedAccounts: z.coerce.boolean().default(true),
  initFiscalPeriods: z.coerce.boolean().default(true),
});

/**
 * Create company with full onboarding (SuperAdmin only)
 * This creates the company AND seeds initial data
 */
export async function createCompanyWithOnboarding(prevState, formData) {
  const session = await auth();

  const formValues = Object.fromEntries(formData.entries());

  if (!session?.user) {
    return { errors: { _form: ["You must be logged in"] }, values: formValues };
  }

  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { errors: { _form: ["Unauthorized: SuperAdmin role required"] }, values: formValues };
  }

  const validatedFields = OnboardingSchema.safeParse(formValues);

  if (!validatedFields.success) {
    console.log("Validation errors:", validatedFields.error.flatten().fieldErrors);
    return { errors: validatedFields.error.flatten().fieldErrors, values: formValues };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    // Check for duplicate name
    const existingCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${data.name}$`, "i") },
    });

    if (existingCompany) {
      return { errors: { name: ["A company with this name already exists"] }, values: formValues };
    }

    // Create company with full setup
    const result = await CompanyOnboardingService.createCompanyWithSetup(
      {
        name: data.name,
        legalName: data.legalName,
        industry: data.industry || "general",
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        website: data.website,
        address: {
          street: data.street,
          city: data.city,
          county: data.county,
          postalCode: data.postalCode,
          country: data.country || "Kenya",
        },
        taxPin: data.taxPin,
        vatNumber: data.vatNumber,
        registrationNumber: data.registrationNumber,
        currency: data.currency || "KES",
        timezone: data.timezone || "Africa/Nairobi",
        fiscalYearStart: data.fiscalYearStart || new Date(new Date().getFullYear(), 0, 1),
        vatRate: data.vatRate ?? 16,
        invoicePrefix: data.invoicePrefix || "INV",
        billPrefix: data.billPrefix || "BILL",
        paymentPrefix: data.paymentPrefix || "PAY",
        quotePrefix: data.quotePrefix || "QT",
        subscriptionPlan: data.subscriptionPlan || "free",
      },
      session.user,
      {
        seedAccounts: data.seedAccounts !== false,
        initFiscalPeriods: data.initFiscalPeriods !== false,
      }
    );

    revalidatePath("/dashboard/admin/companies");

    return {
      success: true,
      message: "Company created and setup completed",
      companyId: result.company.id,
      setup: result.setup,
    };
  } catch (error) {
    console.error("Create company with onboarding error:", error);
    return { errors: { _form: [error.message || "Failed to create company"] }, values: formValues };
  }
}

/**
 * Complete onboarding for existing company (seed data)
 */
export async function completeCompanyOnboarding(companyId, options = {}) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: "You must be logged in" };
  }

  // SuperAdmin can onboard any company, Admin can only onboard their own
  if (!COMPANY_ADMIN_ROLES.includes(session.user.role)) {
    return { success: false, error: "Unauthorized: Admin role required" };
  }

  try {
    await connectDB();

    const company = await Company.findById(companyId);
    if (!company) {
      return { success: false, error: "Company not found" };
    }

    // If not SuperAdmin, check if user belongs to this company
    if (
      session.user.role !== "SuperAdmin" &&
      !isSameCompany(session.user.companyId, companyId)
    ) {
      return { success: false, error: "You can only onboard your own company" };
    }

    // Check if already onboarded
    if (company.settings?.setupCompleted) {
      return { success: false, error: "Company has already been onboarded" };
    }

    const result = await CompanyOnboardingService.completeOnboarding(
      companyId,
      options,
      session.user
    );

    revalidatePath("/dashboard/admin/companies");
    revalidatePath(`/dashboard/admin/companies/${companyId}`);

    return result;
  } catch (error) {
    console.error("Complete onboarding error:", error);
    return { success: false, error: error.message || "Failed to complete onboarding" };
  }
}

/**
 * Get onboarding status for a company
 */
export async function getCompanyOnboardingStatus(companyId) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: "You must be logged in" };
  }

  try {
    await connectDB();

    // SuperAdmin can check any company, others only their own
    if (
      session.user.role !== "SuperAdmin" &&
      !isSameCompany(session.user.companyId, companyId)
    ) {
      return { success: false, error: "Access denied" };
    }

    const status = await CompanyOnboardingService.getOnboardingStatus(companyId);

    return { success: true, ...status };
  } catch (error) {
    console.error("Get onboarding status error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Verify company setup completeness
 */
export async function verifyCompanySetup(companyId) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: "You must be logged in" };
  }

  try {
    await connectDB();

    // SuperAdmin can verify any company, others only their own
    if (
      session.user.role !== "SuperAdmin" &&
      !isSameCompany(session.user.companyId, companyId)
    ) {
      return { success: false, error: "Access denied" };
    }

    const verification = await CompanyOnboardingService.verifySetup(companyId);

    return { success: true, ...verification };
  } catch (error) {
    console.error("Verify setup error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Seed chart of accounts only (for companies that skipped during onboarding)
 */
export async function seedCompanyChartOfAccounts(companyId) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: "You must be logged in" };
  }

  if (!COMPANY_ADMIN_ROLES.includes(session.user.role)) {
    return { success: false, error: "Unauthorized: Admin role required" };
  }

  try {
    await connectDB();

    // Verify access
    if (
      session.user.role !== "SuperAdmin" &&
      !isSameCompany(session.user.companyId, companyId)
    ) {
      return { success: false, error: "Access denied" };
    }

    const result = await CompanyOnboardingService.seedChartOfAccounts(
      companyId,
      session.user
    );

    revalidatePath("/dashboard/accounts");
    revalidatePath("/dashboard/settings/accounts");

    return {
      success: true,
      message: `Created ${result.count} accounts`,
      ...result,
    };
  } catch (error) {
    console.error("Seed accounts error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize fiscal periods only
 */
export async function initializeFiscalPeriods(companyId, fiscalYearStart) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: "You must be logged in" };
  }

  if (!COMPANY_ADMIN_ROLES.includes(session.user.role)) {
    return { success: false, error: "Unauthorized: Admin role required" };
  }

  try {
    await connectDB();

    // Verify access
    if (
      session.user.role !== "SuperAdmin" &&
      !isSameCompany(session.user.companyId, companyId)
    ) {
      return { success: false, error: "Access denied" };
    }

    const result = await CompanyOnboardingService.initializeFiscalPeriods(
      companyId,
      fiscalYearStart || new Date(new Date().getFullYear(), 0, 1),
      session.user
    );

    revalidatePath("/dashboard/settings/fiscal-periods");

    return {
      success: true,
      message: `Created fiscal periods for ${result.fiscalYear}`,
      ...result,
    };
  } catch (error) {
    console.error("Initialize fiscal periods error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// RESET TRANSACTIONAL DATA (Danger Zone)
// ============================================
// Wipes a company's TRANSACTIONS while keeping its master data — the
// "clear the test data, go to production" operation. SuperAdmin only,
// requires typing the exact company name.
//
// KEPT (master/config): company, users, invites, chart of accounts,
// parties, products, categories, employee profiles, KPI definitions,
// integration configs. Balances/quantities on kept docs are ZEROED so
// they don't reference deleted transactions.
//
// WIPED: everything else carrying this companyId — discovered at
// runtime from the live collection list, so new transactional models
// are covered automatically (no hand-list to drift). Counters
// (erpcounters, _id-prefixed) are cleared so numbering restarts at 1.

export async function resetCompanyTransactions(companyId, prevState, formData) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "You must be logged in" };
  }
  if (!SUPER_ADMIN_ROLES.includes(session.user.role)) {
    return { success: false, error: "Unauthorized: SuperAdmin role required" };
  }

  try {
    await connectDB();

    const company = await Company.findById(companyId).select("name").lean();
    if (!company) return { success: false, error: "Company not found" };

    // Typed confirmation — the exact company name, server-enforced.
    const confirmName = (formData.get("confirmName") || "").toString().trim();
    if (confirmName !== company.name) {
      return {
        success: false,
        error: `Confirmation text must match the company name exactly ("${company.name}").`,
      };
    }

    const wipeParties = formData.get("wipeParties") === "on";
    const { summary, totalDeleted } = await resetCompanyData(
      mongoose.connection.db,
      companyId,
      { wipeParties },
    );
    console.warn(
      `[reset-transactions] ${company.name} (${companyId}) by ${session.user.email}: ${totalDeleted} docs across ${Object.keys(summary).length} collections`,
    );

    revalidatePath("/dashboard/admin/companies");
    revalidatePath(`/dashboard/admin/companies/${companyId}`);

    return {
      success: true,
      message: `Reset complete — ${totalDeleted} documents removed across ${Object.keys(summary).length} collections. Master data kept; balances and stock zeroed; numbering restarts at 1.`,
      summary,
    };
  } catch (error) {
    console.error("resetCompanyTransactions error:", error);
    return { success: false, error: "Reset failed — check server logs" };
  }
}
