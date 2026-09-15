/**
 * Local ESLint rules — single file, no extra plugin install needed.
 *
 * Each rule is defined here and re-exported as a plugin. Wire into
 * eslint.config.mjs by adding the plugin to `plugins` and the rule
 * name (`local/no-role-includes`) to `rules`.
 */
import { VERTICALS, BOUNDARY_EXEMPT } from "../lib/modules.mjs";

// ============================================
// no-role-includes
// ============================================
// Flags `someArray.includes(user.role)` style checks because they
// silently exclude SuperAdmin. Use `roleAllowed(role, [...])` from
// `@/lib/permissions` instead — it auto-grants SuperAdmin.
//
// What this catches:
//   ❌ if (!["Admin","HR"].includes(user.role)) { ... }
//   ❌ if (ALLOWED.includes(session.user.role)) { ... }
//   ❌ allowedRoles.includes(user?.role)
//
// What this allows:
//   ✅ roleAllowed(user.role, ["Admin", "HR"])
//   ✅ canSeeFinanceNav(user.role)
//   ✅ items.includes(productId)         // .includes() on anything else
//   ✅ ["a","b"].includes(category)      // not a role
const noRoleIncludes = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Use roleAllowed() helper instead of .includes(role) so SuperAdmin is auto-granted.",
    },
    messages: {
      useHelper:
        "Use roleAllowed(role, [...]) from @/lib/permissions instead of .includes(role) — SuperAdmin must be granted everywhere and the helper handles it.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Must be foo.includes(...) with exactly one arg
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property?.name !== "includes" ||
          node.arguments.length !== 1
        ) {
          return;
        }

        const arg = node.arguments[0];

        // Catch `something.role` (user.role, session.user.role, etc).
        // Also catch optional chains: `user?.role`.
        const endsInRole =
          arg.type === "MemberExpression" && arg.property?.name === "role";

        // Catch bare `role` identifier from destructuring
        // (`const { role } = user; allowed.includes(role)`).
        const isBareRole = arg.type === "Identifier" && arg.name === "role";

        // Catch the canonical-but-still-wrong pattern of a userRole var:
        // `let userRole = ...; allowed.includes(userRole)`.
        const isUserRole =
          arg.type === "Identifier" && arg.name === "userRole";

        if (endsInRole || isBareRole || isUserRole) {
          context.report({ node, messageId: "useHelper" });
        }
      },
    };
  },
};

// ============================================
// no-core-imports-vertical
// ============================================
// Keeps the general modules free of industry-specific dependencies.
//
// The rule, and it is the one Odoo, SAP and Business Central all settle on:
// DEPENDENCIES POINT ONE WAY. A vertical may import from core; core may never
// import from a vertical. Core reaching into a vertical is how a generic ERP
// quietly becomes an industry-specific one, and it is invisible in review because
// each individual import looks reasonable.
//
// Tiers and the paths defining them live in `lib/modules.mjs`, beside the
// reasoning. `app/db/schema/index.ts` is exempt as a barrel.
//
// What this catches:
//   ❌ app/dashboard/projects/x.jsx  importing  @/app/db/repositories/technical
//   ❌ lib/reports.js                importing  ../app/dashboard/calibration/lib
//
// What this allows:
//   ✅ app/dashboard/technical/x.jsx importing  ../projects/lib/workspace
//   ✅ anything within one vertical
const noCoreImportsVertical = {
  meta: {
    type: "problem",
    docs: { description: "core code must not import from an industry vertical" },
    schema: [],
    messages: {
      crossed:
        "Core code must not import from the '{{vertical}}' vertical ('{{path}}'). Dependencies point one way: a vertical may import from core, never the reverse. See lib/modules.mjs.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename() ?? "").replace(/\\/g, "/");
    if (BOUNDARY_EXEMPT.some((e) => filename.endsWith(e))) return {};
    // A vertical importing anything is not this rule's business — only CORE
    // reaching into a vertical is.
    if (VERTICALS.some((v) => v.paths.some((d) => filename.includes(d)))) return {};

    // An import names a module, not a file: `@/app/db/repositories/technical`
    // has no `.ts` while the manifest path does. Compare with extensions
    // stripped from BOTH sides — the first version of this rule matched
    // neither and reported nothing, which is worse than not having it.
    const bare = (x) => x.replace(/\.(tsx?|jsx?|mjs)$/, "");

    function check(node, value) {
      if (typeof value !== "string") return;
      const target = bare(value.replace(/^@\//, ""));
      for (const v of VERTICALS) {
        if (
          v.paths.some((d) => {
            const b = bare(d);
            return target.includes(b) || target.includes(b.replace(/^app\//, ""));
          })
        ) {
          context.report({ node, messageId: "crossed", data: { vertical: v.id, path: value } });
          return;
        }
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => {
        if (node.source?.type === "Literal") check(node, node.source.value);
      },
    };
  },
};

// ============================================
// PLUGIN EXPORT
// ============================================
const plugin = {
  meta: { name: "local", version: "1.0.0" },
  rules: {
    "no-role-includes": noRoleIncludes,
    "no-core-imports-vertical": noCoreImportsVertical,
  },
};

export default plugin;
