/**
 * `server-only` is supplied by Next.js at build time, not installed as a
 * package, so importing any module that guards itself with it fails under
 * Vitest with "Cannot find package 'server-only'". Aliased to this no-op in
 * vitest.config.mjs.
 *
 * The guard exists to stop server modules reaching a client bundle. There is
 * no client bundle in a test run, so replacing it changes nothing the tests
 * care about.
 */
export {};
