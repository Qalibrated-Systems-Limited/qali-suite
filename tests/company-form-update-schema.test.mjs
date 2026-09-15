/**
 * The EDIT form's payload, against the schema that has to accept it.
 *
 * `readForm` fills every field with `formData.get(...)`, which returns null for
 * an input the page does not render — and the edit screen renders no admin
 * name, admin email or plan; those belong to creation. `UpdateCompanySchema`
 * was `CreateCompanySchema.partial()`, and `.partial()` permits `undefined`,
 * NOT null, so every edit failed validation on fields with no input to display
 * the error. The form kept the typed values and saved nothing: "it picks up
 * the changes but cannot persist".
 *
 * No database — this is the shape check that sat between the form and
 * `syncCompanyRecord`, which the repository tests already cover.
 */
import { describe, it, expect } from "vitest";
import { UpdateCompanySchema } from "@/lib/company-form";

/** What `readForm` produces for the edit screen. */
const editPayload = (over = {}) => ({
  adminName: null,
  adminEmail: null,
  plan: null,
  name: "Acme Ltd",
  code: "ACME",
  tagline: "We do things",
  logo: "",
  email: "books@acme.co.ke",
  phone: "0700000000",
  website: "",
  street: "1 Ngong Rd",
  city: "Nairobi",
  state: "",
  postalCode: "00100",
  country: "Kenya",
  taxPin: "P051234567X",
  vatNumber: "",
  registrationNumber: "",
  bankName: "Equity",
  bankBranch: "",
  accountName: "Acme Ltd",
  accountNumber: "123456",
  swiftCode: "",
  mpesaPaybill: "",
  mpesaTill: "",
  currency: "KES",
  defaultVatRate: "16",
  fiscalYearStart: "1",
  defaultPaymentTermsDays: "30",
  capitalizationThreshold: "0",
  requireGRN: false,
  ...over,
});

/** The action drops absent fields before parsing; mirror it here. */
const omitAbsent = (values) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));

describe("UpdateCompanySchema against the edit form", () => {
  it("accepts the payload EXACTLY as readForm builds it, nulls and all", () => {
    // The regression: unstripped, this is what the action used to hand zod.
    const parsed = UpdateCompanySchema.safeParse(editPayload());
    expect(parsed.success, JSON.stringify(parsed.error?.flatten().fieldErrors)).toBe(true);
    expect(parsed.data.name).toBe("Acme Ltd");
  });

  it("accepts it with the absent fields dropped, as the action now parses it", () => {
    const parsed = UpdateCompanySchema.safeParse(omitAbsent(editPayload()));
    expect(parsed.success, JSON.stringify(parsed.error?.flatten().fieldErrors)).toBe(true);
    expect(parsed.data.name).toBe("Acme Ltd");
    expect(parsed.data.code).toBe("ACME");
    expect(parsed.data.defaultVatRate).toBe(16);
  });

  it("does not ask for the fields the edit screen never renders", () => {
    // Even undropped, an update must not be blocked on creation-only identity.
    const parsed = UpdateCompanySchema.safeParse({ name: "Acme Ltd" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("adminName");
    expect(parsed.data).not.toHaveProperty("adminEmail");
  });

  it("keeps an emptied field as an empty string, which is the clear signal", () => {
    // Distinct from absent: "" reaches syncCompanyRecord and nulls the column;
    // dropping it would silently revert the field instead (cba48beed).
    const values = omitAbsent(editPayload({ tagline: "", phone: "" }));
    expect(values.tagline).toBe("");
    const parsed = UpdateCompanySchema.safeParse(values);
    expect(parsed.success).toBe(true);
  });
});
