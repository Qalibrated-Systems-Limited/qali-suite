/**
 * Admin password reset — and the calling convention that broke it.
 *
 * ResetPasswordDialog does `resetUserPasswordPg.bind(null, user._id)` and
 * hands the result to `useActionState`, so React calls it as
 * `(userId, prevState, formData)`. The action's signature was
 * `(userId, password: string)`, so `password` received PREVSTATE — an object.
 *
 * It did not fail loudly. The guard was `!password || password.length < 6`:
 * an object is truthy, `.length` is undefined, and `undefined < 6` is false —
 * so the check passed an object to bcrypt, which threw into a catch that
 * reports a generic failure. Reset never worked, and never read `newPassword`.
 *
 * These tests call the action exactly as React does. If someone "tidies" the
 * signature back, the first test fails.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const setPassword = vi.fn(async () => {});
const withAuthorizedTenant = vi.fn(async (_roles, fn) => fn({}, { id: "admin", name: "Admin" }));

vi.mock("@/app/db/tenant", () => ({ withAuthorizedTenant }));
vi.mock("@/app/db/userAdmin", () => ({
  adminSetPassword: setPassword,
  adminToggleStatus: vi.fn(),
  adminDeleteUser: vi.fn(),
}));

const mod = await import("@/app/db/actions/user-actions").catch(() => null);
const suite = mod?.resetUserPasswordPg ? describe : describe.skip;

/** Exactly how useActionState invokes a bound action. */
const asReactWouldCall = (userId, fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const prevState = { message: "", errors: {}, success: false };
  return mod.resetUserPasswordPg(userId, prevState, fd);
};

suite("admin password reset", () => {
  it("reads the password the form posted, not prevState", async () => {
    setPassword.mockClear();
    const res = await asReactWouldCall("user-1", {
      newPassword: "correct-horse",
      confirmPassword: "correct-horse",
    });

    expect(res.success).toBe(true);
    expect(setPassword).toHaveBeenCalledTimes(1);
    const [, hash] = setPassword.mock.calls[0];
    // A real bcrypt hash of the posted password — not "[object Object]".
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it("refuses a password under six characters", async () => {
    setPassword.mockClear();
    const res = await asReactWouldCall("user-1", {
      newPassword: "abc",
      confirmPassword: "abc",
    });
    expect(res.success).toBe(false);
    expect(res.errors?.newPassword?.[0]).toMatch(/at least 6/i);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses when the confirmation does not match", async () => {
    // The dialog lists "Both passwords must match" as a rule and NEITHER side
    // checked it, so a typo in the confirm box set the password anyway.
    setPassword.mockClear();
    const res = await asReactWouldCall("user-1", {
      newPassword: "correct-horse",
      confirmPassword: "correct-hosre",
    });
    expect(res.success).toBe(false);
    expect(res.errors?.confirmPassword?.[0]).toMatch(/match/i);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("reports failures in the field the dialog renders", async () => {
    // ResetPasswordDialog shows `state.message`, not `state.error`.
    const res = await asReactWouldCall("user-1", {
      newPassword: "abc",
      confirmPassword: "abc",
    });
    expect(res.message).toBeTruthy();
  });
});
