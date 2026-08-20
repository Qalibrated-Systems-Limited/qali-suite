/**
 * Arrays as bound parameters.
 *
 * Interpolating a JavaScript array into a `sql` template does not produce an
 * array — the driver expands it into one parameter per element, so a COALESCE
 * gets a ROW constructor cast to text[] and the statement is a syntax error.
 * That is what broke company creation, and the same mistake in a FROM clause
 * produced "malformed array literal" in the quote conversion.
 *
 * Unit-level: no database needed for the builder, one round trip to prove
 * Postgres accepts what it produces.
 */
import { describe, it, expect } from "vitest";
import { pgArray } from "@/app/db/pgArray";

describe("pgArray", () => {
  it("builds a literal Postgres accepts", () => {
    expect(pgArray(["theft", "write_off", "expiry"])).toBe(
      '{"theft","write_off","expiry"}',
    );
  });

  it("returns null so it composes with COALESCE(…, column)", () => {
    expect(pgArray(undefined)).toBeNull();
    expect(pgArray(null)).toBeNull();
  });

  it("is an empty array, not nothing", () => {
    expect(pgArray([])).toBe("{}");
  });

  it("escapes what would otherwise change the array's shape", () => {
    // A comma inside a value would split it into two elements; a quote or a
    // backslash would end it early.
    expect(pgArray(['a,b'])).toBe('{"a,b"}');
    expect(pgArray(['say "hi"'])).toBe('{"say \\"hi\\""}');
    expect(pgArray(["back\\slash"])).toBe('{"back\\\\slash"}');
  });

  it("takes numbers as well as strings", () => {
    expect(pgArray([1, 2, 3])).toBe('{"1","2","3"}');
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("pgArray against Postgres", () => {
  it("round-trips through a text[] column, commas and quotes included", async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    try {
      const values = ['theft', 'write_off', 'a,b', 'say "hi"'];
      const [row] = await sql`SELECT ${pgArray(values)}::text[] AS arr`;
      expect(row.arr).toEqual(values);
    } finally {
      await sql.end();
    }
  });
});
