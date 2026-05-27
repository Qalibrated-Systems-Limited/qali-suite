import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import local from "./eslint-rules/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  {
    extends: [...nextCoreWebVitals],
    plugins: { local },
    rules: {
      // Forbid `.includes(user.role)` style role gates — they silently
      // exclude SuperAdmin. Use `roleAllowed(role, [...])` from
      // `@/lib/permissions` or a named `canSee*Nav` helper instead.
      "local/no-role-includes": "error",
    },
  },
]);