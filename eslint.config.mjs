import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import local from "./eslint-rules/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// ESLint — BUG GATE, not a style gate
// ============================================
// Requires eslint@9 (eslint@10 removed SourceCode#addGlobals, which
// eslint-config-next@16 still calls — it crashes on v10).
//
// Philosophy: CI fails only on rules that catch real bugs (an undefined
// reference, an unreachable branch). Stylistic/opinionated rules are
// "warn" so they're visible without blocking — the codebase predates
// linting and a hard style gate would be red for months.
//
// The rule that matters most here: `no-undef`. The formatAddress-not-
// imported regression (crashed quote/bill/PO/credit-note creation, shipped
// green because build + tests didn't cover those server actions) is exactly
// what this catches.

export default defineConfig([
  {
    extends: [...nextCoreWebVitals],
    plugins: { local },
    languageOptions: {
      // Next's automatic JSX runtime lets files use JSX without importing
      // React, but some reference `React.` directly — declare it as a global
      // so no-undef doesn't false-positive on it.
      globals: { React: "readonly" },
    },
    rules: {
      // ── ERROR: real bugs ────────────────────────────────────────
      "no-undef": "error", // undefined reference (the formatAddress class)
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-cond-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],

      // ── WARN: valuable but pre-existing/noisy — surface, don't block ──
      // Forbid `.includes(user.role)` gates (they silently exclude
      // SuperAdmin and drift from the nav). Many pre-existing hits + some
      // false positives on the canonical helpers; keep visible as a warning
      // until the inline gates are migrated to roleAllowed/canSee*Nav.
      "local/no-role-includes": "warn",
      "no-unused-vars": "warn",
      "react/no-unescaped-entities": "off",
      // React-compiler purity/effect rules — valuable signal but the codebase
      // predates them; surface as warnings rather than block CI.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react/no-children-prop": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
]);
