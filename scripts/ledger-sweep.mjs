#!/usr/bin/env node
/**
 * Which Mongo ledger postings are still reachable from a screen?
 *
 * WHY THIS EXISTS. The obvious sweep — `grep -rn "\.post(" app/models app/mongodb lib`
 * — has been wrong four times, and each time it declared a module "the last
 * one". It fails in two ways:
 *
 *   1. A posting can live in a MODEL method rather than an action. That is how
 *      expenses survived three sweeps (§9J).
 *   2. A posting is usually WRAPPED in a domain verb. `payment.confirm()`,
 *      `adjustment.approve()` and `movement.reverse()` each post a journal
 *      entry by calling something else inside the model. Grepping the call
 *      sites for `.post(` finds none of them.
 *
 * So this resolves the TRANSITIVE set: find model methods that post directly,
 * then repeatedly add methods that call those, until the set stops growing.
 * Then find which modules call any of them, and which of those a screen can
 * reach.
 *
 * FALSE POSITIVES are the cost of a name-based match — `reverse` also matches
 * `Array.prototype.reverse`, `approve` matches every unrelated approval. Each
 * hit prints its line so you can judge it; that is deliberate, because a sweep
 * that silently filters is how you get a fifth wrong "last one".
 *
 *   node scripts/ledger-sweep.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const SKIP = new Set(["node_modules", ".next", ".git", "dist"]);

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.has(extname(full))) out.push(full);
  }
  return out;
}

const read = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

// ── 1. Model methods that post, resolved transitively ───────────────────────
const METHOD =
  /(\w+)Schema\.(?:methods|statics)\.(\w+)\s*=\s*(?:async\s*)?function/g;
const POSTS = /\.post\(|JournalEntry\.create|new JournalEntry/;

const bodies = new Map(); // "file::method" -> body
const byFile = new Map(); // file -> [method]

for (const file of walk("app/models", new Set([".js"]))) {
  const src = read(file);
  const marks = [...src.matchAll(METHOD)].map((m) => [m.index, m[2]]);
  for (let i = 0; i < marks.length; i++) {
    const [pos, name] = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1][0] : src.length;
    bodies.set(`${basename(file)}::${name}`, src.slice(pos, end));
    if (!byFile.has(basename(file))) byFile.set(basename(file), []);
    byFile.get(basename(file)).push(name);
  }
}

const posting = new Set();
for (const [key, body] of bodies) if (POSTS.test(body)) posting.add(key);

// Closure: a method that calls a posting method is itself a posting method.
for (let changed = true; changed; ) {
  changed = false;
  for (const [key, body] of bodies) {
    if (posting.has(key)) continue;
    const file = key.split("::")[0];
    for (const name of byFile.get(file) ?? []) {
      if (posting.has(`${file}::${name}`) && new RegExp(`\\.\\s*${name}\\s*\\(`).test(body)) {
        posting.add(key);
        changed = true;
        break;
      }
    }
  }
}

console.log("MODEL METHODS THAT POST TO THE LEDGER (transitively)");
console.log("=".repeat(72));
const grouped = new Map();
for (const key of [...posting].sort()) {
  const [file, name] = key.split("::");
  if (!grouped.has(file)) grouped.set(file, []);
  grouped.get(file).push(name);
}
for (const [file, names] of grouped) {
  console.log(`  ${file.padEnd(26)} ${names.sort().join(", ")}`);
}

// ── 2. Modules that call one, and screens that reach the module ─────────────
const names = new Set([...posting].map((k) => k.split("::")[1]));
const screenFiles = [
  ...walk("app/dashboard", new Set([".js", ".jsx", ".ts", ".tsx"])),
  ...walk("components", new Set([".js", ".jsx", ".ts", ".tsx"])),
  ...walk("app/api", new Set([".js", ".ts"])),
];

const findings = [];
for (const file of [
  ...walk("app/mongodb", new Set([".js", ".ts"])),
  ...walk("lib", new Set([".js", ".ts"])),
]) {
  const src = read(file);
  const lines = src.split("\n");
  const hits = [];
  for (const name of names) {
    const re = new RegExp(`\\.\\s*${name}\\s*\\(`);
    lines.forEach((line, i) => {
      if (re.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        hits.push({ name, line: i + 1, text: line.trim().slice(0, 96) });
      }
    });
  }
  if (!hits.length) continue;

  const stem = basename(file).replace(/\.(js|ts)$/, "");
  const re = new RegExp(`mongodb/(actions/|queries/|services/)?${stem}"`);
  const screens = screenFiles.filter((s) => re.test(read(s)));
  if (screens.length) findings.push({ file, hits, screens: screens.length });
}

console.log();
console.log("LIVE — a screen reaches a module that calls one");
console.log("=".repeat(72));
if (!findings.length) console.log("  none");
for (const f of findings.sort((a, b) => b.screens - a.screens)) {
  console.log(`\n  ${f.file}   <- ${f.screens} screen(s)`);
  for (const h of f.hits) console.log(`      :${h.line}  ${h.text}`);
}
console.log();
console.log(
  `${findings.length} module(s) to review. Read each line — \`reverse\` also matches`,
);
console.log("Array.reverse, and `approve` matches every unrelated approval.");
