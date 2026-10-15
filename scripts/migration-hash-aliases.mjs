#!/usr/bin/env node
/**
 * Writes app/db/migrations/meta/hash-aliases.json: every EARLIER version of
 * every migration file, found in git history, keyed by the hash drizzle would
 * have recorded for it.
 *
 * WHY. app/db/migrate.mjs decides a migration is applied when its content hash
 * is recorded. Some migrations were edited after databases had already run
 * them (0041, 0052, 0056, 0059, 0062, 0095), and some of those were re-stamped
 * as well. A database that ran the old text records the old hash under a
 * different `when`, so without this list the runner sees the migration as new
 * and re-runs it into "already exists".
 *
 * `sqlDiffers` is true when the old text differs from the current one in more
 * than comments and whitespace. Such a database really does have an older
 * schema than the current file describes, and the runner warns about it rather
 * than pretend otherwise.
 *
 * Run after editing an already-applied migration, with full history
 * (`git fetch --unshallow` on a shallow clone):
 *
 *   node scripts/migration-hash-aliases.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "app/db/migrations";
const OUT = `${DIR}/meta/hash-aliases.json`;

const git = (...args) =>
  execFileSync("git", args, {
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
const hash = (s) => createHash("sha256").update(s).digest("hex");
// The SQL a migration runs, ignoring comments and layout.
const sqlOnly = (s) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
// "0131_commissions" -> "commissions": a rename keeps the name, not the number.
const stem = (path) =>
  path.split("/").pop().replace(/\.sql$/, "").replace(/^\d+_/, "");

if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
  console.error("Shallow clone: run `git fetch --unshallow` first.");
  process.exit(1);
}

const { entries } = JSON.parse(readFileSync(`${DIR}/meta/_journal.json`, "utf8"));
const current = new Map(); // hash -> tag
const text = new Map(); // tag -> current file
const byStem = new Map(entries.map(({ tag }) => [stem(tag), tag]));
const orphans = []; // a migration name the current journal no longer has
for (const { tag } of entries) {
  const body = readFileSync(`${DIR}/${tag}.sql`, "utf8");
  current.set(hash(body), tag);
  text.set(tag, body);
}

// Every migration file in every commit on every branch. Following the current
// filenames with --follow misses versions another branch numbered differently
// (Faith's 0097_an_invoice_remembers_who_sold_it, for one).
const seen = new Set();
const aliases = {};
for (const commit of git("rev-list", "--all").split("\n").filter(Boolean)) {
  for (const line of git("ls-tree", commit, `${DIR}/`).split("\n").filter(Boolean)) {
    const [meta, path] = line.split("\t");
    const blob = meta.split(" ")[2];
    if (!path.endsWith(".sql") || seen.has(blob)) continue;
    seen.add(blob);
    const body = git("cat-file", "-p", blob);
    const h = hash(body);
    if (current.has(h)) continue;
    const tag = byStem.get(stem(path));
    if (!tag) {
      orphans.push(`${path} @ ${commit.slice(0, 7)}`);
      continue;
    }
    aliases[h] = {
      tag,
      commit: commit.slice(0, 7),
      sqlDiffers: sqlOnly(body) !== sqlOnly(text.get(tag)),
    };
  }
}

const sorted = Object.fromEntries(
  Object.entries(aliases).sort(([, a], [, b]) => a.tag.localeCompare(b.tag)),
);
writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");
console.log(`✓ ${Object.keys(sorted).length} earlier versions → ${OUT}`);
if (orphans.length) {
  // Not an alias of anything: a database that ran one of these has objects no
  // current migration describes. Worth a person's look, not a guess.
  console.warn("! Migration files with no current counterpart:");
  for (const o of orphans) console.warn(`  ${o}`);
}
