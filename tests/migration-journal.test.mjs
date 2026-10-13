/**
 * The migration journal holds together — asserted, because the failure it
 * prevents is silent.
 *
 * `app/db/migrate.mjs` decides what to apply with one comparison:
 *
 *     if (lastAt !== undefined && migration.folderMillis <= lastAt) continue;
 *
 * So a migration whose `when` is less than or equal to one already applied is
 * SKIPPED, and the runner prints "✓ Migrations applied" and exits zero. There
 * is no error, no warning, and no way to tell from the output that a table was
 * never created.
 *
 * That very nearly shipped. Two branches numbered migrations by hand, counting
 * +60000 from 0116, one index apart — so `qsl/main`'s 0117–0121 all landed at
 * or below the `when` of an already-applied 0122 on the production branch.
 * Merging would have skipped custom_roles, role_permissions, the BOQ cost-code
 * join, project methodology and the project default cost account, while the
 * merged code expected all five.
 *
 * It was caught by reading the two journals side by side. This is so the next
 * one is caught by running the tests.
 *
 * NO DATABASE. These are facts about files, so this runs in every environment
 * including a fresh clone with nothing provisioned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "app/db/migrations");
const journal = JSON.parse(
  readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8"),
);
const entries = journal.entries;

describe("migration journal", () => {
  it("has entries", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  /**
   * THE ONE THAT MATTERS. Everything else here is tidiness; this is the one
   * that decides whether a migration runs at all.
   */
  it("never lets `when` go backwards", () => {
    const backwards = [];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].when <= entries[i - 1].when) {
        backwards.push(
          `${entries[i - 1].tag} (${entries[i - 1].when}) then ` +
            `${entries[i].tag} (${entries[i].when}) — the runner would SKIP the second`,
        );
      }
    }
    expect(backwards).toEqual([]);
  });

  it("gives every migration a distinct `when`", () => {
    // Two migrations sharing a `when` means whichever sorts second is skipped
    // the moment the first is applied.
    const seen = new Map();
    const dupes = [];
    for (const e of entries) {
      if (seen.has(e.when)) dupes.push(`${e.when}: ${seen.get(e.when)} and ${e.tag}`);
      seen.set(e.when, e.tag);
    }
    expect(dupes).toEqual([]);
  });

  it("gives every migration a distinct tag and idx", () => {
    const tags = entries.map((e) => e.tag);
    expect(tags.length).toBe(new Set(tags).size);
    const idxs = entries.map((e) => e.idx);
    expect(idxs.length).toBe(new Set(idxs).size);
  });

  it("names a file that exists, for every entry", () => {
    const missing = entries
      .map((e) => `${e.tag}.sql`)
      .filter((f) => !existsSync(join(MIGRATIONS, f)));
    expect(missing).toEqual([]);
  });

  it("has no .sql on disk that the journal does not name", () => {
    // An orphan never runs, and nothing anywhere says so.
    const named = new Set(entries.map((e) => e.tag));
    const orphans = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .filter((tag) => !named.has(tag));
    expect(orphans).toEqual([]);
  });

  it("keeps idx in order", () => {
    // Cosmetic next to `when`, and the thing a merge most often disturbs.
    // `npm run db:journal:fix` re-sequences it.
    const idxs = entries.map((e) => e.idx);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });
});
