import { z } from "zod";
import { getPlanLimits } from "@/lib/plans";

/**
 * The company form's shape — schemas, defaults and role gates.
 *
 * Lifted out of `app/mongodb/actions/company-actions.js` (0101 follow-up) so
 * the Postgres actions can validate the same form without importing a module
 * that pulls in mongoose. Nothing here changed: it is the same schema the
 * form has always been checked against, in a file with no database in it.
 */
export function buildInitialSubscription(plan) {
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
export const optionalString = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === "" || val === null ? undefined : val));

// Helper for optional URL - allows empty string or valid URL
export const optionalUrl = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === "" || val === null ? undefined : val))
  .refine((val) => !val || z.string().url().safeParse(val).success, {
    message: "Invalid URL format",
  });

// Helper for optional numbers - handles empty strings
export const optionalNumber = (min, max) =>
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

export const CreateCompanySchema = z.object({
  // ── The company's own administrator ──────────────────────────────────────
  // REQUIRED, not optional. A company created with nobody able to administer
  // it is a company only platform staff can operate — which quietly makes the
  // SuperAdmin's standing access load-bearing instead of a fallback. Every ERP
  // that sells to businesses asks for this at creation: NetSuite takes an
  // admin email when the account is opened, Xero has a subscriber, Odoo's
  // creation wizard assigns one. The person who runs the business should be
  // able to run their books without us.
  adminName: z.string().min(1, "The company administrator's name is required").max(50),
  adminEmail: z
    .string()
    .email("Enter a valid email for the company administrator")
    .transform((v) => v.toLowerCase().trim()),

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

/**
 * The same form MINUS the two fields that belong to creation.
 *
 * The edit screen renders no admin name or email — an existing company's
 * administrator is managed from Users, and `syncCompanyRecord` cannot write
 * either one. `.partial()` permits `undefined`, not `null`, and `formData.get`
 * returns null for an input that is not on the page, so leaving them in made
 * every update fail validation on two fields with no input to show the error.
 */
export const UpdateCompanySchema = CreateCompanySchema.omit({
  adminName: true,
  adminEmail: true,
}).partial();

// ============================================
// AUTHORIZATION HELPERS
// ============================================

export const SUPER_ADMIN_ROLES = ["SuperAdmin"];
export const COMPANY_ADMIN_ROLES = ["SuperAdmin", "Admin"];
