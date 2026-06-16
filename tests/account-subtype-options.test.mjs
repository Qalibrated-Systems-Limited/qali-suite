/**
 * Guard: the account-form sub-type dropdown can't drift from server validation.
 *
 * The account create/update action validates subType with z.enum(accountSubType).
 * The form renders accountSubTypeOptions. If an option's value isn't in the
 * enum, the user picks it and submission fails with "Invalid option: expected
 * one of …" — which is exactly the bug this guards against (e.g. the form once
 * offered "current_liability"/"equity"/"revenue"/"expense" while the enum had
 * none of them).
 */
import { describe, it, expect } from "vitest";
import { accountSubType, accountSubTypeOptions } from "@/lib/utils";

describe("account sub-type options vs validation enum", () => {
  it("every dropdown option is an accepted accountSubType value", () => {
    const valid = new Set(accountSubType);
    const invalid = accountSubTypeOptions
      .map((o) => o.value)
      .filter((v) => !valid.has(v));
    expect(invalid).toEqual([]);
  });

  it("has no duplicate option values", () => {
    const values = accountSubTypeOptions.map((o) => o.value);
    expect(values.length).toBe(new Set(values).size);
  });
});
