/**
 * Licensing — the key signer and the catalogue, without a database — 0108.
 *
 * The JWT signer is the heart of the ported License service: a license key IS
 * an ES256-signed token, and everything downstream (client offline verify, the
 * validate endpoint's signature pre-check) trusts that it round-trips. These
 * assertions hold that contract and the feature/app catalogues the issue form
 * and validation share, with no Postgres — a signer and a lookup table, not a
 * query.
 *
 * The signer imports `server-only`; mocked to nothing so it loads under Node.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const jwtMod = await import("@/lib/licensing/jwt");
const {
  signLicenseToken,
  verifyLicenseToken,
  getPublicKeyPem,
  isSigningKeyConfigured,
} = jwtMod;
const {
  FEATURES,
  APP_IDS,
  isValidFeature,
  isValidAppId,
  findUnknownFeatures,
  parseFeatures,
  featureLabel,
  appLabel,
} = await import("@/lib/licensing/features");

describe("license JWT signer", () => {
  const base = {
    customerId: "CUST-42",
    appId: "qalitrack-kiosk",
    features: ["kiosk", "reports"],
    expiresAt: new Date(Date.now() + 86_400_000),
  };

  it("signs a three-segment ES256 token and verifies it back", () => {
    const token = signLicenseToken(base);
    expect(token.split(".")).toHaveLength(3);

    const payload = verifyLicenseToken(token);
    expect(payload.sub).toBe("CUST-42");
    expect(payload.app).toBe("qalitrack-kiosk");
    expect(payload.features).toEqual(["kiosk", "reports"]);
    expect(payload.iss).toBe("qalibrated.co.ke");
  });

  it("carries the machine binding only when one is given", () => {
    expect(verifyLicenseToken(signLicenseToken(base)).mid).toBeUndefined();
    const bound = verifyLicenseToken(signLicenseToken({ ...base, machineId: "MID-9" }));
    expect(bound.mid).toBe("MID-9");
  });

  it("rejects a tampered token", () => {
    const token = signLicenseToken(base);
    const parts = token.split(".");
    // Flip a character in the payload segment.
    parts[1] = parts[1].slice(0, -2) + (parts[1].slice(-2) === "AA" ? "BB" : "AA");
    expect(() => verifyLicenseToken(parts.join("."))).toThrow();
  });

  it("rejects an expired token on verify", () => {
    const token = signLicenseToken({ ...base, expiresAt: new Date(Date.now() - 1000) });
    expect(() => verifyLicenseToken(token)).toThrow();
  });

  it("uses the ephemeral dev key when none is configured", () => {
    // No LICENSE_JWT_PRIVATE_KEY in the test env.
    expect(isSigningKeyConfigured()).toBe(false);
    expect(getPublicKeyPem()).toContain("BEGIN PUBLIC KEY");
  });
});

describe("licensing catalogue", () => {
  it("knows its own features and rejects strangers", () => {
    expect(isValidFeature("kiosk")).toBe(true);
    expect(isValidFeature("teleport")).toBe(false);
    expect(findUnknownFeatures(["kiosk", "teleport", "rfid"])).toEqual(["teleport"]);
  });

  it("knows its own apps", () => {
    expect(isValidAppId("qalitrack-frontend")).toBe(true);
    expect(isValidAppId("some-app")).toBe(false);
  });

  it("every feature has a group the UI can render", () => {
    for (const f of FEATURES) expect(["hardware", "modules"]).toContain(f.group);
    expect(APP_IDS.length).toBeGreaterThan(0);
  });

  it("parses the stored comma column and labels values", () => {
    expect(parseFeatures("kiosk, reports ,,rfid")).toEqual(["kiosk", "reports", "rfid"]);
    expect(parseFeatures("")).toEqual([]);
    expect(featureLabel("kiosk")).toBe("Unmanned Kiosk");
    expect(featureLabel("unknown")).toBe("unknown");
    expect(appLabel("qalitrack-mobile")).toContain("Mobile");
  });
});
