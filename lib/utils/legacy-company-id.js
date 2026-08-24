/**
 * The id Mongo documents are keyed by, given the uuid the session carries.
 *
 * Companies moved to Postgres in 0035, so `session.user.companyId` is a uuid.
 * Mongo documents still carry the ObjectId they were written with. Anything
 * building a Mongo tenant filter has to bridge that, and `new ObjectId(uuid)`
 * throws BSONError.
 *
 * WHY THIS IS ITS OWN MODULE, and not part of tenant-utils: about 85 call
 * sites across 25 files build the filter INLINE — `isSuperAdmin ? {} : {
 * companyId: new ObjectId(companyId) }` — rather than calling the shared
 * helper, and several of them are `app/models/*` files that must not import
 * `@/auth` transitively just to cast an id. This file imports nothing at
 * module scope, so anything can use it.
 *
 * `_migration_id_map` holds the pairing, one row per company, and it never
 * changes: it is the record of a migration that has already happened. Loaded
 * once per process, lazily, and read synchronously thereafter.
 */

const legacyByUuid = new Map();
let loaded = false;
let loading = null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/**
 * Fill the map. Awaited by `getTenantContext`, which every request calls
 * before it reaches a synchronous filter builder.
 *
 * Concurrent callers share one in-flight load rather than each opening their
 * own query — a dashboard render calls getTenantContext from dozens of server
 * components at once.
 */
export async function loadLegacyCompanyIds() {
  if (loaded) return;
  if (loading) return loading;

  loading = (async () => {
    try {
      const [{ privilegedDb }, { sql }] = await Promise.all([
        import("@/app/db/provisioning"),
        import("drizzle-orm"),
      ]);
      const rows = await privilegedDb().execute(sql`
        SELECT old_object_id, new_uuid
          FROM _migration_id_map
         WHERE collection = 'companies'
      `);
      for (const r of rows) {
        legacyByUuid.set(String(r.new_uuid), String(r.old_object_id));
      }
      loaded = true;
    } catch {
      // Left unloaded so the next request retries. translateCompanyId throws a
      // named error rather than letting a BSONError surface from a query.
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * A 24-hex id passes straight through — a company that predates the migration,
 * or a caller that already translated. A uuid is looked up. Anything else is
 * returned untouched, so a Mongo id in some other shape still reaches the
 * driver and fails there rather than here.
 */
export function translateCompanyId(companyId) {
  if (companyId == null) return companyId;
  const id = String(companyId);
  if (OBJECT_ID_RE.test(id)) return id;

  const legacy = legacyByUuid.get(id);
  if (legacy) return legacy;

  if (UUID_RE.test(id)) {
    throw new Error(
      `No legacy Mongo id for company ${id}. Mongo collections are keyed by ` +
        `the ObjectId they were written with, and _migration_id_map has no ` +
        `'companies' row for this uuid — a company created after the ` +
        `migration has no Mongo documents to scope to. The module reading ` +
        `this needs to move to Postgres.`,
    );
  }
  return id;
}

/** Test seam: lets a suite populate the map without a database. */
export function __setLegacyCompanyId(uuid, legacyId) {
  legacyByUuid.set(String(uuid), String(legacyId));
  loaded = true;
}
