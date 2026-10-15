#!/usr/bin/env node
// ============================================================================
// CREATE A MIGRATION — timestamped, because sequential numbers collide
//
//   npm run db:new -- "add default cost account to projects"
//   npm run db:journal:fix          (after a merge, re-sequence idx)
//
// WHY THIS EXISTS. Migrations were numbered 0001, 0002, 0003 … and the number
// was picked by hand, as was the journal's `when`, by adding 60000 to the last
// one. Two branches then did the obvious thing at the same time:
//
//   feat/postgres-migration        qsl/main
//   0117_adjustment_valuation      0117_project_methodology
//   0118_view_security_invoker     0118_cost_code_boq_items
//   …                              …
//
// The filenames collided, which is annoying and visible. The `when` values
// collided too, which is neither — and `when` is the only thing drizzle's
// runner reads (app/db/migrate.mjs now goes by recorded hash; see its header):
//
//     if (lastAt !== undefined && migration.folderMillis <= lastAt) continue;
//
// Both branches had counted +60000 from 0116, one index apart, so main's
// 0117–0121 all landed at or below the `when` of our already-applied 0122.
// Merging the two would have SKIPPED five migrations — custom_roles,
// role_permissions, the BOQ cost-code join, project methodology and the
// project default cost account — while the merged code expected every one of
// them, and the migrator would have printed "✓ Migrations applied" and exited
// zero. A schema silently missing five tables, reported as success.
//
// WHAT CHANGES. The tag is the creation instant:
//
//     20261013T142335_add_default_cost_account.sql
//
// and `when` is that same instant in epoch milliseconds, from the clock rather
// than from arithmetic. Two developers on two branches cannot produce the same
// value, and cannot produce values whose ORDER disagrees with the order the
// work was actually done in. The ordering is correct by construction instead
// of by everyone remembering to add 60000.
//
// `idx` stays sequential because the journal is an array and that is what it
// means. It can still collide on a merge — both branches append the next
// integer — but that collision is cosmetic and `--fix-journal` re-sequences
// it. The dangerous field is `when`, and `when` is now safe.
//
// THE EXISTING 0000–0132 KEEP THEIR NAMES. They are applied in production and
// renaming an applied migration is how you get it applied twice. The old
// scheme is history; this is what new ones look like.
// ============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "app/db/migrations");
const JOURNAL = join(MIGRATIONS, "meta/_journal.json");

const readJournal = () => JSON.parse(readFileSync(JOURNAL, "utf8"));
const writeJournal = (j) =>
  writeFileSync(JOURNAL, JSON.stringify(j, null, 2) + "\n");

/** `20261013T142335` — sortable, readable, and unique to the second. */
function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/**
 * The invariants the whole scheme exists to hold. Asserted on every create and
 * every fix, and by tests/migration-journal.test.mjs on every run — because
 * the failure this prevents is silent, and a silent failure needs a check that
 * is not optional.
 */
function verify(entries) {
  const problems = [];
  const seenTag = new Set();
  const seenWhen = new Set();
  const seenIdx = new Set();

  for (const e of entries) {
    if (seenTag.has(e.tag)) problems.push(`duplicate tag: ${e.tag}`);
    if (seenWhen.has(e.when)) problems.push(`duplicate when: ${e.when} (${e.tag})`);
    if (seenIdx.has(e.idx)) problems.push(`duplicate idx: ${e.idx} (${e.tag})`);
    seenTag.add(e.tag); seenWhen.add(e.when); seenIdx.add(e.idx);

    const file = join(MIGRATIONS, `${e.tag}.sql`);
    if (!existsSync(file)) problems.push(`journal names a missing file: ${e.tag}.sql`);
  }

  // THE ONE THAT MATTERS. Out-of-order `when` is what makes the runner skip.
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].when <= entries[i - 1].when) {
      problems.push(
        `when goes backwards: ${entries[i - 1].tag} (${entries[i - 1].when}) ` +
          `then ${entries[i].tag} (${entries[i].when}) — the runner would SKIP the second`,
      );
    }
  }

  // A .sql on disk that no journal entry names never runs, and nothing says so.
  const named = new Set(entries.map((e) => e.tag));
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const tag = f.replace(/\.sql$/, "");
    if (!named.has(tag)) problems.push(`orphan file, not in the journal: ${f}`);
  }

  return problems;
}

// ── --fix-journal: re-sequence idx after a merge ────────────────────────────
if (process.argv.includes("--fix-journal")) {
  const j = readJournal();
  // By `when`, never by idx — `when` is the truth and idx is the label.
  j.entries.sort((a, b) => a.when - b.when);
  j.entries.forEach((e, i) => { e.idx = i; });
  const problems = verify(j.entries);
  if (problems.length) {
    console.error("Journal still has problems after re-sequencing:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  writeJournal(j);
  console.log(`Journal re-sequenced: ${j.entries.length} entries, idx 0..${j.entries.length - 1}`);
  process.exit(0);
}

// ── create ──────────────────────────────────────────────────────────────────
const description = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
if (!description) {
  console.error('Usage: npm run db:new -- "what this migration does"');
  process.exit(1);
}

const j = readJournal();
const last = j.entries[j.entries.length - 1];
const now = Date.now();

// Real time has to be ahead of the newest entry. It is, by about two months —
// the old `when` values were counted rather than clocked, so they drifted
// behind reality. If this ever fires, something has rewritten history.
if (now <= last.when) {
  console.error(
    `Clock is behind the journal: now=${now}, last=${last.when} (${last.tag}).\n` +
      "A new migration would sort BEFORE an applied one and be skipped.",
  );
  process.exit(1);
}

const tag = `${stamp(new Date(now))}_${slugify(description)}`;
const file = join(MIGRATIONS, `${tag}.sql`);
if (existsSync(file)) {
  console.error(`${tag}.sql already exists — wait a second and try again.`);
  process.exit(1);
}

writeFileSync(
  file,
  `-- ============================================================================
-- ${description.toUpperCase()}
--
-- WHAT THIS CHANGES, and why it is worth a migration. Say what was wrong, not
-- only what is now true — the next person reads this to find out whether their
-- bug is this one.
--
-- SAFE TO APPLY because: (existing rows comply / the column is nullable /
-- nothing writes it yet). A CHECK or NOT NULL validates every existing row the
-- moment it is added, so query production for violations BEFORE writing one:
--
--     SELECT count(*) FROM <table> WHERE <the new rule is false>;
--
-- If that is not zero, clean the data or add the constraint NOT VALID.
-- ============================================================================

-- Separate every statement with the breakpoint, or they run as one.
;--> statement-breakpoint
`,
);

j.entries.push({
  idx: last.idx + 1,
  version: last.version,
  when: now,
  tag,
  breakpoints: true,
});

const problems = verify(j.entries);
if (problems.length) {
  console.error("Refusing to write — the journal would be invalid:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
writeJournal(j);

console.log(`Created app/db/migrations/${tag}.sql`);
console.log(`Journal: idx ${last.idx + 1}, when ${now}`);
console.log("\nNext: write the SQL, mirror it in app/db/schema/, then");
console.log("      npm run db:migrate:all");
