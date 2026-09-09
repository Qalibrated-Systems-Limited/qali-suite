#!/usr/bin/env node
/**
 * Guards the migration journal.
 *
 * WHY THIS EXISTS. Twice now a merge with a parallel branch has produced a
 * migration that would never run, with no error at either end:
 *
 *   2026-09-01  Both sides appended `+1000` to the same `when` from 0075, so
 *               four timestamps collided exactly. Four objects would have been
 *               silently absent from every database that had already run ours.
 *
 *   2026-09-09  A branch inserted helpdesk/hse at 0089/0090 with `when` values
 *               BELOW our 0103. Git merged it without a conflict — the renames
 *               were 100% similarity — and twelve tables would never have been
 *               created on any database already carrying our chain.
 *
 * Both are the same fact wearing different clothes:
 *
 *   DRIZZLE DECIDES WHAT TO RUN FROM THE JOURNAL'S `when`, AND NOTHING ELSE.
 *
 * See drizzle-orm/pg-core/dialect: it selects the newest `created_at` from
 * `drizzle.__drizzle_migrations` and applies a migration only when
 * `lastDbMigration.created_at < migration.folderMillis`. Filenames and `idx`
 * are cosmetic to it. The recorded hash is written but never compared, so
 * editing an applied migration is silently ignored too.
 *
 * The consequence is that a migration introduced BELOW a database's high-water
 * mark is skipped for ever, and `db:migrate` still prints "✓ Migrations
 * applied". This script is what turns that into a failed build.
 *
 * Run: node scripts/check-migrations.mjs   (also wired into CI before migrate)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "app/db/migrations";
const JOURNAL = join(DIR, "meta/_journal.json");

const problems = [];
const fail = (title, detail) => problems.push({ title, detail });

const journal = JSON.parse(readFileSync(JOURNAL, "utf8"));
const entries = journal.entries ?? [];
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -4));

// ── 1. The journal and the directory must describe the same set ─────────────
const tags = entries.map((e) => e.tag);
const tagSet = new Set(tags);
const fileSet = new Set(files);

for (const tag of tags) {
  if (!fileSet.has(tag)) {
    fail(
      `journal names a migration with no file: ${tag}`,
      "The migrator would try to read it and crash mid-run.",
    );
  }
}
for (const f of files) {
  if (!tagSet.has(f)) {
    fail(
      `migration file is not in the journal: ${f}.sql`,
      "Drizzle iterates the JOURNAL, not the directory. A file that is not " +
        "listed there is never applied — and nothing says so.",
    );
  }
}

// ── 2. Tags and idx must be unique ──────────────────────────────────────────
const seenTag = new Set();
for (const t of tags) {
  if (seenTag.has(t)) fail(`duplicate journal tag: ${t}`, "");
  seenTag.add(t);
}
const seenIdx = new Set();
for (const e of entries) {
  if (seenIdx.has(e.idx)) {
    fail(
      `duplicate idx ${e.idx} (${e.tag})`,
      "Usually the fingerprint of a merge that took both sides' numbering.",
    );
  }
  seenIdx.add(e.idx);
}

// ── 3. `when` must be strictly increasing — THE ONE THAT MATTERS ────────────
for (let i = 1; i < entries.length; i++) {
  const prev = entries[i - 1];
  const cur = entries[i];
  if (cur.when === prev.when) {
    fail(
      `identical \`when\` on ${prev.tag} and ${cur.tag} (${cur.when})`,
      "Two branches appended the same increment to the same parent. One of " +
        "these will never run on a database that has applied the other.",
    );
  } else if (cur.when < prev.when) {
    fail(
      `\`when\` goes backwards: ${cur.tag} (${cur.when}) after ${prev.tag} (${prev.when})`,
      "A migration whose `when` is below the high-water mark of a database is " +
        "SILENTLY SKIPPED there for ever. If this arrived in a merge, re-stamp " +
        "it above the last entry rather than reordering the file.",
    );
  }
}

// ── 4. Directory order must match apply order ───────────────────────────────
// Not required by drizzle, but if they disagree then reading the folder tells
// you the wrong story about what runs when — which is how both incidents got
// past review.
const sortedFiles = [...files].sort();
for (let i = 0; i < Math.min(sortedFiles.length, tags.length); i++) {
  if (sortedFiles[i] !== tags[i]) {
    fail(
      `filename order and journal order diverge at position ${i}`,
      `directory has "${sortedFiles[i]}", journal has "${tags[i]}". ` +
        "Renaming is safe (drizzle ignores filenames) — make the names match " +
        "the journal so the folder reads in apply order.",
    );
    break;
  }
}

// ── 5. Naming convention ────────────────────────────────────────────────────
// Legacy: NNNN_name. New (2026-09-09 onward): YYYYMMDDHHMM_name, so two people
// on separate branches cannot pick the same number in the first place.
const LEGACY = /^\d{4}_/;
const STAMPED = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_/;
let sawStamped = false;

for (const tag of tags) {
  const stamped = STAMPED.exec(tag);
  if (stamped) {
    sawStamped = true;
    const [, y, mo, d, h, mi] = stamped.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
      fail(`not a real timestamp: ${tag}`, "Expected YYYYMMDDHHMM_name.sql.");
    }
    continue;
  }
  if (LEGACY.test(tag)) {
    if (sawStamped) {
      fail(
        `legacy 4-digit migration after a timestamped one: ${tag}`,
        "New migrations use the timestamp form. Sequential numbers are what " +
          "collide when two branches run in parallel.",
      );
    }
    continue;
  }
  fail(
    `unrecognised migration name: ${tag}`,
    "Expected NNNN_name.sql (legacy) or YYYYMMDDHHMM_name.sql (current).",
  );
}

// ── Report ──────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  const last = entries.at(-1);
  console.log(
    `✓ migration journal OK — ${entries.length} entries, ` +
      `high-water mark ${last?.when} (${last?.tag})`,
  );
  process.exit(0);
}

console.error(`✗ migration journal: ${problems.length} problem(s)\n`);
for (const { title, detail } of problems) {
  console.error(`  • ${title}`);
  if (detail) {
    for (const line of detail.match(/.{1,72}(\s|$)/g) ?? [detail]) {
      console.error(`      ${line.trim()}`);
    }
  }
  console.error("");
}
process.exit(1);
