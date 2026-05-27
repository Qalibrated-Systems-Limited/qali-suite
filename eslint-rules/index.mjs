/**
 * Local ESLint rules — single file, no extra plugin install needed.
 *
 * Each rule is defined here and re-exported as a plugin. Wire into
 * eslint.config.mjs by adding the plugin to `plugins` and the rule
 * name (`local/no-role-includes`) to `rules`.
 */

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
// PLUGIN EXPORT
// ============================================
const plugin = {
  meta: { name: "local", version: "1.0.0" },
  rules: {
    "no-role-includes": noRoleIncludes,
  },
};

export default plugin;
