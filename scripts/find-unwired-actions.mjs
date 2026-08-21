#!/usr/bin/env node
// ============================================
// FIND PORTED ACTIONS NOTHING CALLS
// ============================================
// A ported action that no screen calls is invisible. It typechecks, its tests
// pass — because the tests call it directly, which is precisely the layer
// nothing else uses — and the screen goes on calling the Mongo action beside
// it. The module reads as done and is not.
//
// That is not hypothetical. Quotes shipped in exactly that state: the
// repository, nine write actions and their tests all landed with §9E, nothing
// was pointed at them, and the list page was moved to Postgres anyway. A quote
// raised through the UI went to Mongo and was searched for in Postgres, so it
// never appeared on the page it was created from. See §9E's follow-up in
// docs/POSTGRES-MIGRATION-PLAN.md.
//
// Run this at the end of every port. READ the output rather than counting it:
// a form-data adapter, or a lower-level variant a route handler will want, can
// legitimately have no screen calling it. What you are looking for is a whole
// write path — several actions from one file, all unwired at once.
//
// Usage:
//   node scripts/find-unwired-actions.mjs [--json]
// ============================================
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ACTION_DIR = "app/db/actions";
// Where a caller could plausibly live. Tests are deliberately EXCLUDED — a
// test calling the action is the false negative this script exists to defeat.
const SEARCH_ROOTS = ["app", "components", "lib", "hooks"];
const SEARCHABLE = /\.(m?[jt]sx?)$/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (SEARCHABLE.test(entry.name)) {
      yield full;
    }
  }
}

const actionFiles = (await readdir(ACTION_DIR))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(ACTION_DIR, f));

// name -> the file that declares it
const declared = new Map();
for (const file of actionFiles) {
  const src = await readFile(file, "utf8");
  for (const m of src.matchAll(/^export async function ([A-Za-z0-9_]+)/gm)) {
    declared.set(m[1], file);
  }
}

// One pass over the tree, counting references per name. Grepping once per
// action is ~200 full-tree scans and takes minutes; this takes a second.
const callers = new Map([...declared.keys()].map((n) => [n, new Set()]));
for (const root of SEARCH_ROOTS) {
  for await (const file of walk(root)) {
    const src = await readFile(file, "utf8");
    for (const [name, home] of declared) {
      // Its own declaration is not a call site. Nor is a re-export from
      // another action file — that is still inside the layer.
      if (file === home) continue;
      if (file.startsWith(ACTION_DIR)) continue;
      if (new RegExp(`\\b${name}\\b`).test(src)) {
        callers.get(name).add(relative(process.cwd(), file));
      }
    }
  }
}

const unwired = [...declared]
  .filter(([name]) => callers.get(name).size === 0)
  .map(([name, home]) => ({ action: name, declaredIn: home }));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(unwired, null, 2));
} else if (!unwired.length) {
  console.log(`✓ Every one of ${declared.size} ported actions has a caller.`);
} else {
  const byFile = new Map();
  for (const { action, declaredIn } of unwired) {
    if (!byFile.has(declaredIn)) byFile.set(declaredIn, []);
    byFile.get(declaredIn).push(action);
  }
  console.log(
    `${unwired.length} of ${declared.size} ported actions have no caller outside app/db/actions:\n`,
  );
  for (const [file, names] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const n of names) console.log(`    ${n}`);
    console.log("");
  }
  console.log(
    "A whole file's worth means the screens were never pointed at it.\n" +
      "One or two usually means a helper nothing needed yet.",
  );
}
