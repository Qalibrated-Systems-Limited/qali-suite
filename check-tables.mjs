import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PG_URL ||
  process.env.DB_URL;

if (!url) {
  console.error(
    "No DB URL found. Set one of DATABASE_URL / POSTGRES_URL / PG_URL / DB_URL in .env",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const wanted = [
  "project_methodologies",
  "project_cost_code_boq_items",
  "project_cost_codes",
  "project_budget_lines",
];

try {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${wanted})
  `;
  const found = new Set(rows.map((r) => r.table_name));
  console.log("Table check:");
  for (const t of wanted) {
    console.log(`  ${found.has(t) ? "✓" : "✗ MISSING"}  ${t}`);
  }

  // Which migrations does drizzle think are applied?
  try {
    const mig = await sql`
      select hash, created_at
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 5
    `;
    console.log(`\nLast ${mig.length} recorded migrations (newest first):`);
    for (const m of mig) console.log(`  ${m.created_at}  ${m.hash.slice(0, 12)}`);
  } catch {
    // migrations table may live in the public schema instead
    try {
      const mig = await sql`
        select hash, created_at
        from public.__drizzle_migrations
        order by created_at desc
        limit 5
      `;
      console.log(`\nLast ${mig.length} recorded migrations (public schema):`);
      for (const m of mig) console.log(`  ${m.created_at}  ${m.hash.slice(0, 12)}`);
    } catch (e) {
      console.log("\n(could not read __drizzle_migrations:", e.message, ")");
    }
  }
} finally {
  await sql.end();
}
